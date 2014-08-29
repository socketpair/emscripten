import os, json, logging
import shared
from subprocess import Popen, CalledProcessError
import multiprocessing
from tools.shared import check_call

stdout = None
stderr = None

def call_process(cmd):
  proc = Popen(cmd, stdout=stdout)
  proc.communicate()
  if proc.returncode != 0:
    raise CalledProcessError(proc.returncode, cmd)

def calculate(temp_files, in_temp, stdout_, stderr_, forced=[]):
  global stdout, stderr
  stdout = stdout_
  stderr = stderr_

  # Check if we need to include some libraries that we compile. (We implement libc ourselves in js, but
  # compile a malloc implementation and stdlibc++.)

  def read_symbols(path, exclude=None):
    symbols = map(lambda line: line.strip().split(' ')[1], open(path).readlines())
    if exclude:
      symbols = filter(lambda symbol: symbol not in exclude, symbols)
    return set(symbols)

  # XXX We also need to add libc symbols that use malloc, for example strdup. It's very rare to use just them and not
  #     a normal malloc symbol (like free, after calling strdup), so we haven't hit this yet, but it is possible.
  libc_symbols = read_symbols(shared.path_from_root('system', 'lib', 'libc.symbols'))
  libcextra_symbols = read_symbols(shared.path_from_root('system', 'lib', 'libcextra.symbols'))
  libcxx_symbols = read_symbols(shared.path_from_root('system', 'lib', 'libcxx', 'symbols'), exclude=libc_symbols)
  libcxxabi_symbols = read_symbols(shared.path_from_root('system', 'lib', 'libcxxabi', 'symbols'), exclude=libc_symbols)
  gl_symbols = read_symbols(shared.path_from_root('system', 'lib', 'gl.symbols'))

  # XXX we should disable EMCC_DEBUG when building libs, just like in the relooper

  def run_commands(commands):
    cores = int(os.environ.get('EMCC_CORES') or multiprocessing.cpu_count())
    cores = min(len(commands), cores)
    if cores <= 1:
      for command in commands:
        call_process(command)
    else:
      pool = multiprocessing.Pool(processes=cores)
      pool.map(call_process, commands, chunksize=1)

  def build_libc(lib_filename, files, lib_opts):
    o_s = []
    prev_cxx = os.environ.get('EMMAKEN_CXX')
    if prev_cxx: os.environ['EMMAKEN_CXX'] = ''
    musl_internal_includes = ['-I', shared.path_from_root('system', 'lib', 'libc', 'musl', 'src', 'internal'), '-I', shared.path_from_root('system', 'lib', 'libc', 'musl', 'arch', 'js')]
    commands = []
    for src in files:
      o = in_temp(os.path.basename(src) + '.o')
      commands.append([shared.PYTHON, shared.EMCC, shared.path_from_root('system', 'lib', src), '-o', o] + musl_internal_includes + lib_opts)
      o_s.append(o)
    run_commands(commands)
    if prev_cxx: os.environ['EMMAKEN_CXX'] = prev_cxx
    shared.Building.link(o_s, in_temp(lib_filename))
    return in_temp(lib_filename)

  def build_libcxx(src_dirname, lib_filename, files, lib_opts):
    o_s = []
    commands = []
    for src in files:
      o = in_temp(src + '.o')
      srcfile = shared.path_from_root(src_dirname, src)
      commands.append([shared.PYTHON, shared.EMXX, srcfile, '-o', o, '-std=c++11'] + lib_opts)
      o_s.append(o)
    run_commands(commands)
    shared.Building.link(o_s, in_temp(lib_filename))
    return in_temp(lib_filename)

  # libc
  def create_libc():
    logging.debug(' building libc for cache')
    libc_files = [
      'dlmalloc.c',
    ]
    musl_files = [
      ['ctype', [
       'isdigit.c',
       'isspace.c',
       'isupper.c',
       'isxdigit.c',
       'tolower.c',
      ]],
      ['internal', [
       'intscan.c',
       'floatscan.c',
       'shgetc.c',
      ]],
      ['math', [
       'frexp.c',
       'frexpf.c',
       'frexpl.c',
       'scalbn.c',
       'scalbnl.c',
      ]],
      ['multibyte', [
       'wctomb.c',
       'wcrtomb.c',
      ]],
      ['prng', [
       '__rand48_step.c',
       '__seed48.c',
       'drand48.c',
       'lcong48.c',
       'lrand48.c',
       'mrand48.c',
       'rand_r.c',
       'rand.c',
       'random.c',
       'seed48.c',
       'srand48.c'
      ]],
      ['stdio', [
       '__overflow.c',
       '__toread.c',
       '__towrite.c',
       '__uflow.c',
       'fwrite.c',
       'snprintf.c',
       'sprintf.c',
       'vfprintf.c',
       'vsnprintf.c',
       'vsprintf.c',
      ]],
      ['stdlib', [
       'atof.c',
       'atoi.c',
       'atol.c',
       'strtod.c',
       'strtol.c',
      ]],
      ['string', [
       'memchr.c',
       'memcmp.c',
       'strcasecmp.c',
       'strcmp.c',
       'strncasecmp.c',
       'strncmp.c',
      ]]
    ]
    for directory, sources in musl_files:
      libc_files += [os.path.join('libc', 'musl', 'src', directory, source) for source in sources]
    return build_libc('libc.bc', libc_files, ['-O2'])

  def apply_libc(need):
    # libc needs some sign correction. # If we are in mode 0, switch to 2. We will add our lines
    try:
      if shared.Settings.CORRECT_SIGNS == 0: raise Exception('we need to change to 2')
    except: # we fail if equal to 0 - so we need to switch to 2 - or if CORRECT_SIGNS is not even in Settings
      shared.Settings.CORRECT_SIGNS = 2
    if shared.Settings.CORRECT_SIGNS == 2:
      shared.Settings.CORRECT_SIGNS_LINES = [shared.path_from_root('src', 'dlmalloc.c') + ':' + str(i+4) for i in [4816, 4191, 4246, 4199, 4205, 4235, 4227]]
    # If we are in mode 1, we are correcting everything anyhow. If we are in mode 3, we will be corrected
    # so all is well anyhow too.
    return True

  # libcextra
  def create_libcextra():
    logging.debug('building libcextra for cache')
    musl_files = [
       ['compat', [
        'strlwr.c',
        'strtol_l.c',
        'strupr.c'
       ]],
       ['ctype', [
        'isalnum.c',
        'isalpha.c',
        'isascii.c',
        'isblank.c',
        'iscntrl.c',
        'isgraph.c',
        'islower.c',
        'isprint.c',
        'ispunct.c',
        'iswalnum.c',
        'iswalpha.c',
        'iswblank.c',
        'iswcntrl.c',
        'iswctype.c',
        'iswdigit.c',
        'iswgraph.c',
        'iswlower.c',
        'iswprint.c',
        'iswpunct.c',
        'iswspace.c',
        'iswupper.c',
        'iswxdigit.c',
        'toascii.c',
        'toupper.c',
        'towctrans.c',
        'wcswidth.c',
        'wctrans.c',
        'wcwidth.c',
       ]],
       ['legacy', [
        'err.c',
       ]],
       ['locale', [
        'iconv.c',
        'isalnum_l.c',
        'isalpha_l.c',
        'isblank_l.c',
        'iscntrl_l.c',
        'isdigit_l.c',
        'isgraph_l.c',
        'islower_l.c',
        'isprint_l.c',
        'ispunct_l.c',
        'isspace_l.c',
        'isupper_l.c',
        'isxdigit_l.c',
        'iswalnum_l.c',
        'iswalpha_l.c',
        'iswblank_l.c',
        'iswcntrl_l.c',
        'iswctype_l.c',
        'iswdigit_l.c',
        'iswgraph_l.c',
        'iswlower_l.c',
        'iswprint_l.c',
        'iswpunct_l.c',
        'iswspace_l.c',
        'iswupper_l.c',
        'iswxdigit_l.c',
        'strcoll.c',
        'strcasecmp_l.c',
        'strfmon.c',
        'strncasecmp_l.c',
        'strxfrm.c',
        'tolower_l.c',
        'toupper_l.c',
        'towctrans_l.c',
        'towlower_l.c',
        'towupper_l.c',
        'wcscoll.c',
        'wcscoll_l.c',
        'wcsxfrm.c',
        'wcsxfrm_l.c',
        'wctrans_l.c',
        'wctype_l.c',
       ]],
       ['math', [
        '__cos.c',
        '__cosdf.c',
        '__sin.c',
        '__sindf.c',
        'ilogb.c',
        'ilogbf.c',
        'ilogbl.c',
        'ldexp.c',
        'ldexpf.c',
        'ldexpl.c',
        'logb.c',
        'logbf.c',
        'logbl.c',
        'lgamma.c',
        'lgamma_r.c',
        'lgammaf.c',
        'lgammaf_r.c',
        'lgammal.c',
        'scalbnf.c',
        'signgam.c',
        'tgamma.c',
        'tgammaf.c',
        'tgammal.c'
       ]],
       ['misc', [
        'ffs.c',
        'getopt.c',
        'getopt_long.c',
       ]],
       ['multibyte', [
        'btowc.c',
        'internal.c',
        'mblen.c',
        'mbrlen.c',
        'mbrtowc.c',
        'mbsinit.c',
        'mbsnrtowcs.c',
        'mbsrtowcs.c',
        'mbstowcs.c',
        'mbtowc.c',
        'wcsnrtombs.c',
        'wcsrtombs.c',
        'wcstombs.c',
        'wctob.c',
       ]],
       ['regex', [
        'fnmatch.c',
        'regcomp.c',
        'regerror.c',
        'regexec.c',
        'tre-mem.c',
       ]],
       ['stdio', [
        '__string_read.c',
        'asprintf.c',
        'fwprintf.c',
        'swprintf.c',
        'vfwprintf.c',
        'vswprintf.c',
        'vwprintf.c',
        'wprintf.c',
        'fputwc.c',
        'fputws.c',
        'sscanf.c',
        'vasprintf.c',
        'vfscanf.c',
        'vsscanf.c',
       ]],
       ['stdlib', [
         'atoll.c',
         'bsearch.c',
         'ecvt.c',
         'fcvt.c',
         'gcvt.c',
         'qsort.c',
         'wcstod.c',
         'wcstol.c',
       ]],
       ['string', [
         'bcmp.c',
         'bcopy.c',
         'bzero.c',
         'index.c',
         'memccpy.c',
         'memmem.c',
         'mempcpy.c',
         'memrchr.c',
         'rindex.c',
         'stpcpy.c',
         'strcasestr.c',
         'strchr.c',
         'strchrnul.c',
         'strcspn.c',
         'strdup.c',
         'strlcat.c',
         'strlcpy.c',
         'strncat.c',
         'strndup.c',
         'strnlen.c',
         'strpbrk.c',
         'strrchr.c',
         'strsep.c',
         'strsignal.c',
         'strspn.c',
         'strstr.c',
         'strtok.c',
         'strtok_r.c',
         'strverscmp.c',
         'wcpcpy.c',
         'wcpncpy.c',
         'wcscasecmp.c',
         'wcscasecmp_l.c',
         'wcscat.c',
         'wcschr.c',
         'wcscmp.c',
         'wcscpy.c',
         'wcscspn.c',
         'wcsdup.c',
         'wcslen.c',
         'wcsncasecmp.c',
         'wcsncasecmp_l.c',
         'wcsncat.c',
         'wcsncmp.c',
         'wcsncpy.c',
         'wcsnlen.c',
         'wcspbrk.c',
         'wcsrchr.c',
         'wcsspn.c',
         'wcsstr.c',
         'wcstok.c',
         'wcswcs.c',
         'wmemchr.c',
         'wmemcmp.c',
         'wmemcpy.c',
         'wmemmove.c',
         'wmemset.c',
       ]]
    ]
    libcextra_files = []
    for directory, sources in musl_files:
      libcextra_files += [os.path.join('libc', 'musl', 'src', directory, source) for source in sources]
    return build_libc('libcextra.bc', libcextra_files, ['-O2'])

  # libcxx
  def create_libcxx():
    logging.debug('building libcxx for cache')
    libcxx_files = [
      'algorithm.cpp',
      'condition_variable.cpp',
      'future.cpp',
      'iostream.cpp',
      'memory.cpp',
      'random.cpp',
      'stdexcept.cpp',
      'system_error.cpp',
      'utility.cpp',
      'bind.cpp',
      'debug.cpp',
      'hash.cpp',
      'mutex.cpp',
      'string.cpp',
      'thread.cpp',
      'valarray.cpp',
      'chrono.cpp',
      'exception.cpp',
      'ios.cpp',
      'locale.cpp',
      'regex.cpp',
      'strstream.cpp'
    ]
    return build_libcxx(os.path.join('system', 'lib', 'libcxx'), 'libcxx.bc', libcxx_files, ['-Oz', '-Wno-warn-absolute-paths', '-I' + shared.path_from_root('system', 'lib', 'libcxxabi', 'include')])

  def apply_libcxx(need):
    assert shared.Settings.QUANTUM_SIZE == 4, 'We do not support libc++ with QUANTUM_SIZE == 1'
    # libcxx might need corrections, so turn them all on. TODO: check which are actually needed
    shared.Settings.CORRECT_SIGNS = shared.Settings.CORRECT_OVERFLOWS = shared.Settings.CORRECT_ROUNDINGS = 1
    #logging.info('using libcxx turns on CORRECT_* options')
    return True

  # libcxxabi - just for dynamic_cast for now
  def create_libcxxabi():
    logging.debug('building libcxxabi for cache')
    libcxxabi_files = [
      'abort_message.cpp',
      'cxa_aux_runtime.cpp',
      'cxa_default_handlers.cpp',
      'cxa_demangle.cpp',
      'cxa_exception_storage.cpp',
      'cxa_new_delete.cpp',
      'cxa_handlers.cpp',
      'exception.cpp',
      'stdexcept.cpp',
      'typeinfo.cpp',
      'private_typeinfo.cpp',
      os.path.join('..', '..', 'libcxx', 'new.cpp'),
    ]
    return build_libcxx(os.path.join('system', 'lib', 'libcxxabi', 'src'), 'libcxxabi.bc', libcxxabi_files, ['-Oz', '-Wno-warn-absolute-paths', '-I' + shared.path_from_root('system', 'lib', 'libcxxabi', 'include')])

  def apply_libcxxabi(need):
    assert shared.Settings.QUANTUM_SIZE == 4, 'We do not support libc++abi with QUANTUM_SIZE == 1'
    #logging.info('using libcxxabi, this may need CORRECT_* options')
    #shared.Settings.CORRECT_SIGNS = shared.Settings.CORRECT_OVERFLOWS = shared.Settings.CORRECT_ROUNDINGS = 1
    return True

  # gl
  def create_gl():
    prev_cxx = os.environ.get('EMMAKEN_CXX')
    if prev_cxx: os.environ['EMMAKEN_CXX'] = ''
    o = in_temp('gl.o')
    check_call([shared.PYTHON, shared.EMCC, shared.path_from_root('system', 'lib', 'gl.c'), '-o', o])
    if prev_cxx: os.environ['EMMAKEN_CXX'] = prev_cxx
    return o

  # Setting this in the environment will avoid checking dependencies and make building big projects a little faster
  # 1 means include everything; otherwise it can be the name of a lib (libcxx, etc.)
  # You can provide 1 to include everything, or a comma-separated list with the ones you want
  force = os.environ.get('EMCC_FORCE_STDLIBS')
  force_all = force == '1'
  force = set((force.split(',') if force else []) + forced)
  if force: logging.debug('forcing stdlibs: ' + str(force))

  # Setting this will only use the forced libs in EMCC_FORCE_STDLIBS. This avoids spending time checking
  # for unresolved symbols in your project files, which can speed up linking, but if you do not have
  # the proper list of actually needed libraries, errors can occur. See below for how we must
  # export all the symbols in deps_info when using this option.
  only_forced = os.environ.get('EMCC_ONLY_FORCED_STDLIBS')
  if only_forced:
    temp_files = []

  # Add in some hacks for js libraries. If a js lib depends on a symbol provided by a C library, it must be
  # added to here, because our deps go only one way (each library here is checked, then we check the next
  # in order - libcxx, libcxextra, etc. - and then we run the JS compiler and provide extra symbols from
  # library*.js files. But we cannot then go back to the C libraries if a new dep was added!
  # TODO: Move all __deps from src/library*.js to deps_info.json, and use that single source of info
  #       both here and in the JS compiler.
  deps_info = json.loads(open(shared.path_from_root('src', 'deps_info.json')).read())
  added = set()
  def add_back_deps(need):
    more = False
    for ident, deps in deps_info.iteritems():
      if ident in need.undefs and not ident in added:
        added.add(ident)
        more = True
        for dep in deps:
          need.undefs.add(dep)
          shared.Settings.EXPORTED_FUNCTIONS.append('_' + dep)
    if more:
      add_back_deps(need) # recurse to get deps of deps

  # Scan symbols
  symbolses = map(lambda temp_file: shared.Building.llvm_nm(temp_file), temp_files)

  if len(symbolses) == 0:
    class Dummy:
      defs = set()
      undefs = set()
    symbolses.append(Dummy())

  # depend on exported functions
  for export in shared.Settings.EXPORTED_FUNCTIONS:
    if shared.Settings.VERBOSE: logging.debug('adding dependency on export %s' % export)
    symbolses[0].undefs.add(export[1:])

  for symbols in symbolses:
    add_back_deps(symbols)

  # If we are only doing forced stdlibs, then we don't know the actual symbols we need,
  # and must assume all of deps_info must be exported. Note that this might cause
  # warnings on exports that do not exist.
  if only_forced:
    for key, value in deps_info.iteritems():
      for dep in value:
        shared.Settings.EXPORTED_FUNCTIONS.append('_' + dep)

  all_needed = set()
  for symbols in symbolses:
    all_needed.update(symbols.undefs)
  for symbols in symbolses:
    all_needed.difference_update(symbols.defs)

  # Go over libraries to figure out which we must include
  ret = []
  has = need = None
  for name, create, apply_, library_symbols, deps in [('libcxx',    create_libcxx,    apply_libcxx,    libcxx_symbols,    ['libcextra', 'libcxxabi']),
                                                      ('libcextra', create_libcextra, lambda x: True,  libcextra_symbols, ['libc']),
                                                      ('libcxxabi', create_libcxxabi, apply_libcxxabi, libcxxabi_symbols, ['libc']),
                                                      ('gl',        create_gl,        lambda x: True,  gl_symbols,        ['libc']),
                                                      ('libc',      create_libc,      apply_libc,      libc_symbols,      [])]:
    force_this = force_all or name in force
    if not force_this:
      need = set()
      has = set()
      for symbols in symbolses:
        if shared.Settings.VERBOSE: logging.debug('undefs: ' + str(symbols.undefs))
        for library_symbol in library_symbols:
          if library_symbol in symbols.undefs:
            need.add(library_symbol)
          if library_symbol in symbols.defs:
            has.add(library_symbol)
      for haz in has: # remove symbols that are supplied by another of the inputs
        if haz in need:
          need.remove(haz)
      if shared.Settings.VERBOSE: logging.debug('considering %s: we need %s and have %s' % (name, str(need), str(has)))
    if force_this or (len(need) > 0 and not only_forced):
      if apply_(need):
        # We need to build and link the library in
        logging.debug('including %s' % name)
        libfile = shared.Cache.get(name, create)
        ret.append(libfile)
        force = force.union(deps)
  return ret

