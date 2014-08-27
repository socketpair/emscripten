'use strict';

var funs = {
  emulate_SYS_rt_sigaction: function() {
    Module.printErr('SYS_rt_sigaction STUB implementation');
    return 0;
  },
  emulate_SYS_rt_sigprocmask: function() {
    Module.printErr('SYS_rt_sigprocmask STUB implementation');
    return 0;
  },
  emulate_SYS_sigreturn: function() {
    Module.printErr('SYS_sigreturn STUB implementation');
    return 0;
  },
  emulate_SYS_rt_sigreturn: function() {
    Module.printErr('SYS_rt_sigreturn STUB implementation');
    return 0;
  },
  emulate_SYS_setitimer: function() {
    Module.printErr('SYS_setitimer STUB implementation');
    return 0;
  }

  /*
    SYS_getitimer
    SYS_getpid
    SYS_gettid
    SYS_kill
    SYS_rt_sigaction
    SYS_rt_sigpending
    SYS_rt_sigprocmask
    SYS_rt_sigqueueinfo
    SYS_rt_sigreturn
    SYS_setitimer
    SYS_sigaltstack
    SYS_sigreturn
    SYS_tgkill
  */

};

mergeInto(LibraryManager.library, funs);
