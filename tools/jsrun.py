import time, os, sys
from subprocess import Popen, PIPE, STDOUT

# Logs a message to stderr, forcing a flush afterwards to have all messages immediately show up on the console.
# This is used instead of the logging framework in some places where standard prints are routed via stderr
# instead of stdout in cases where stdout is reserved for other use, or muted via a PIPEd process call.
def logmsg(str):
  print >> sys.stderr, str
  if os.name == 'nt':
    sys.stderr.flush()

TRACK_PROCESS_SPAWNS = True if (os.getenv('EM_BUILD_VERBOSE') and int(os.getenv('EM_BUILD_VERBOSE')) >= 3) else False

def timeout_run(proc, timeout, note='unnamed process', full_output=False):
  start = time.time()
  if timeout is not None:
    while time.time() - start < timeout and proc.poll() is None:
      time.sleep(0.1)
    if proc.poll() is None:
      proc.kill() # XXX bug: killing emscripten.py does not kill it's child process!
      raise Exception("Timed out: " + note)
  out = proc.communicate()
  out = map(lambda o: '' if o is None else o, out)
  if TRACK_PROCESS_SPAWNS:
    logmsg('Process ' + str(proc.pid) + ' finished after ' + str(time.time() - start) + ' seconds.')
  return '\n'.join(out) if full_output else out[0]

def run_js(filename, engine=None, args=[], check_timeout=False, stdin=None, stdout=PIPE, stderr=None, cwd=None, full_output=False):
  if type(engine) is not list:
    engine = [engine]
  command = engine + [filename] + (['--'] if 'd8' in engine[0] or 'jsc' in engine[0] else []) + args
  proc = Popen(
      command,
      stdin=stdin,
      stdout=stdout,
      stderr=stderr,
      cwd=cwd)
  timeout = 15*60 if check_timeout else None
  if TRACK_PROCESS_SPAWNS:
    logmsg('Blocking on process ' + str(proc.pid) + ': ' + str(command) + (' for ' + str(timeout) + ' seconds' if timeout else ' until it finishes.'))
  return timeout_run(
    proc, 
    timeout,
    'Execution',
    full_output=full_output)
