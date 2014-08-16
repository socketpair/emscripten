'use strict'

var funs = {
  $SIG: {
    stub: function(name) {
      Module.printErr('Calling stub instead of ' + name + '()');
    },
    partial: function(name) {
       Module.printErr('Using partial implelementation of ' + name + '()');
    },
    unimplemented: function(name) {
      throw '' + name + '() is not implemented yet';
    },
    queue_signal: function(sig) {
      SIG.pending_signals |= sig;
      SIG.call_signal_handlers();
    },
    call_signal_handlers: function() {
      var i, bit;
      var active_signals = SIG.current_sigmask & SIG.pending_signals;
      while (active_signals) {
        bit = 1;
        for (i = 0; i < 32; i++, bit <<= 1) {
            if (active_signals & bit) {
              SIG.pending_signals &= ~bit;
              // TODO: SIGBLOCK(i); -- depending on sigaction flag...
              SIG.call_handler(i);
              // TODO: SIGUNBLOCK(i);
              // current_sigmask may have been changed...recalculate
              active_signals = current_sigmask & pending_signals;
              break;
            }
        }
      }
    },
    call_handler: function(sig) {
      var handler = SIG.signal_handlers[sig];
      if (handler === 1 /* ign*/)
        return;
      if (handler === 0 /* dfl */)
        handler = SIG.dfl_map[sig];
      handler();
    },
    pending_signals: 0,
    signal_handlers: (function() { var res=[]; var i; for(i=0; i<32; i++) res.push(0); return res; })(),
/*
    dfl_map: [
      null,
      SIG.terminate,  // SIGHUP       1
      SIG.terminate,  // SIGINT       2
      SIG.core,       // SIGQUIT      3
      SIG.core,       // SIGILL       4
      SIG.core,       // SIGTRAP      5
      SIG.core,       // SIGABRT      6
      SIG.core,       // SIGBUS       7
      SIG.core,       // SIGFPE       8
      SIG.terminate,  // SIGKILL      9
      SIG.terminate,  // SIGUSR1      10
      SIG.core,       // SIGSEGV      11
      SIG.terminate,  // SIGUSR2      12
      SIG.terminate,  // SIGPIPE      13
      SIG.terminate,  // SIGALRM      14
      SIG.terminate,  // SIGTERM      15
      SIG.terminate,  // SIGSTKFLT    16
      SIG.ignore,     // SIGCHLD      17
      SIG.cont,       // SIGCONT      18
      SIG.stop,       // SIGSTOP      19
      SIG.stop,       // SIGTSTP      20
      SIG.stop,       // SIGTTIN      21
      SIG.stop,       // SIGTTOU      22
      SIG.ignore,     // SIGURG       23
      SIG.core,       // SIGXCPU      24
      SIG.core,       // SIGXFSZ      25
      SIG.terminate,  // SIGVTALRM    26
      SIG.terminate,  // SIGPROF      27
      SIG.ignore,     // SIGWINCH     28
      SIG.terminate,  // SIGIO        29
      SIG.terminate,  // SIGPWR       30
      SIG.core        // SIGSYS       31
    ],
*/
    terminate: function() {
        // TODO: specify which signal
        Module.printErr('Exitting due to unhandled signal');
        Module['exit'](1);
    },
    core: function() {
        // TODO: specify which signal, and also core=terminate
        Module.printErr('Core dumping due to unhandled signal');
        Module['exit'](1);
    },
    ignore: function() { Module.printErr('Ignoring unhandled signal'); },
    cont: function() { Module.printErr('SIGCONT is not implemented. Doing nothing'); },
    stop: function() { Module.printErr('SIGSTOP is not implemented. Doing nothing'); },
  },

  signal__deps: ['$SIG'],
  signal: function(sig, func) {
    SIG.stub('signal');
    return 0;
  },
  sigemptyset: function(set) {
    // TODO: these functions handles only 32 signals...
    {{{ makeSetValue('set', '0', '0', 'i32') }}};
    return 0;
  },
  sigfillset: function(set) {
    {{{ makeSetValue('set', '0', '-1>>>0', 'i32') }}};
    return 0;
  },
  sigaddset: function(set, signum) {
    {{{ makeSetValue('set', '0', makeGetValue('set', '0', 'i32') + '| (1 << (signum-1))', 'i32') }}};
    return 0;
  },
  sigdelset: function(set, signum) {
    {{{ makeSetValue('set', '0', makeGetValue('set', '0', 'i32') + '& (~(1 << (signum-1)))', 'i32') }}};
    return 0;
  },
  sigismember: function(set, signum) {
    return {{{ makeGetValue('set', '0', 'i32') }}} & (1 << (signum-1));
  },
/*
  sigaction__deps: ['$SIG'],
  sigaction: function(signum, act, oldact) {
    console.log('installing handler for signal ', signum);

    var sa_handler = {{{ makeGetValue('act', 0, 'i32') }}};
    var sa_sigaction = {{{ makeGetValue('act', 4, 'i32') }}};
    var sa_mask = {{{ makeGetValue('act', 8, 'i32') }}};
    var sa_flags = {{{ makeGetValue('act', 136, 'i32') }}};
    var sa_restorer = {{{ makeGetValue('act', 144, 'i32') }}};

    console.log('sa_handler=', sa_handler, sa_sigaction, sa_mask);

    SIG.stub('sigaction');
    return 0;
  },*/

  sigprocmsk__deps: ['$SIG'],
  sigprocmask: function() {
    SIG.stub('sigprocmask');
    return 0;
  },
  __libc_current_sigrtmin: function() {
    SIG.stub('__libc_current_sigrtmin');
    return 0;
  },
  __libc_current_sigrtmax: function() {
    SIG.stub('__libc_current_sigrtmax');
    return 0;
  },
  kill__deps: ['$ERRNO_CODES', '__setErrNo', '$SIG'],
  kill: function(pid, sig) {
    SIG.partial('kill');
    if (sig < 1 || sig > 31 ) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
    if (pid >= 0) {
      if (pid == mypid) {
        SIG.queue_signal(sig);
        return 0;
      } else {
        ___setErrNo(ERRNO_CODES.ESRCH);
        return -1;
      }
    }
    if (pid == -1) {
      // Linux does not signal itself on that call.
      // No other processes exists, so ESRCH :)
      ___setErrNo(ERRNO_CODES.ESRCH);
      return -1;
    }
    if (pid < 0) {
      // we are only one process on our group
      if (-pid == mypid) {
        SIG.queue_signal(sig);
        return 0;
      } else {
        ___setErrNo(ERRNO_CODES.ESRCH);
        return -1;
      }
    }
  },

  killpg__deps: ['kill'],
  killpg: function(pgrp, sig) {
    // man killpg: On Linux, killpg() is implemented as a library function that makes the call kill(-pgrp, sig).
    return kill(-pgrp, sig);
  },
  siginterrupt__deps: ['$SIG'],
  siginterrupt: function() {
    SIG.stub('siginterrupt');
    return 0;
  },

  raise__deps: ['kill'],
  raise: function(sig) {
    return kill(getpid(), sig);
  },

  aparm__deps: ['$SIG'],
  alarm: function(seconds) {
    // unsigned alarm(unsigned seconds);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/alarm.html
    // We don't support signals, and there's no way to indicate failure, so just
    // fail silently.
    SIG.unimplemented('alarm');
  },
  ualarm__deps: ['$SIG'],
  ualarm: function() {
    SIG.unimplemented('ualarm');
  },
  setitimer__deps: ['$SIG'],
  setitimer: function(which, new_value, old_value) {
    // TODO: C_STRUCTS.itimerval.it_interval.tv_sec + tv_usec (!)
    var sec = {{{ makeGetValue('new_value', C_STRUCTS.itimerspec.it_interval.tv_sec, 'i32') }}};
    var usec = {{{ makeGetValue('new_value', C_STRUCTS.itimerspec.it_interval.tv_nsec, 'i32') }}};
    var new_timer_interval = sec * 1000 + usec / 1000; // in ms
    sec = {{{ makeGetValue('new_value', C_STRUCTS.itimerspec.it_value.tv_sec, 'i32') }}};
    usec = {{{ makeGetValue('new_value', C_STRUCTS.itimerspec.it_value.tv_nsec, 'i32') }}};
    var new_timer_value = sec * 1000 + usec / 1000; // in ms
    console.log('zxc', which, new_timer_interval, new_timer_value);
    SIG.unimplemented('setitimer');
  },
  getitimer__deps: ['$SIG'],
  getitimer: function() {
    SIG.unimplemented('getitimer');
  },
  pause__deps: ['__setErrNo', '$ERRNO_CODES', '$SIG'],
  pause: function() {
    // int pause(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/pause.html
    // We don't support signals, so we return immediately.
    SIG.stub('pause');
    ___setErrNo(ERRNO_CODES.EINTR);
    return -1;
  }
  //signalfd
  //ppoll
  //epoll_pwait
  //pselect
  //sigvec
  //sigmask
  //sigblock
  //sigsetmask
  //siggetmask
  //sigpending
  //sigsuspend
  //bsd_signal
  //siginterrupt
  //sigqueue
  //sysv_signal
  //signal
  //pthread_kill
  //gsignal
  //ssignal
  //psignal
  //psiginfo
  //sigpause
  //sigisemptyset
  //sigtimedwait
  //sigwaitinfo
  //sigreturn
  //sigstack
  //sigaltstack(2)
  //sigsetops(3),
  //sighold
  //sigrelse
  //sigignore
  //sigset
  //timer_create (!)

};

mergeInto(LibraryManager.library, funs);
