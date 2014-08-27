'use strict'
var funs = {
  alarm: function(seconds) {
    // unsigned alarm(unsigned seconds);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/alarm.html
    // We don't support signals, and there's no way to indicate failure, so just
    // fail silently.
    throw 'alarm() is not implemented yet';
  },
  ualarm: function() {
    throw 'ualarm() is not implemented yet';
  },
  pause__deps: ['__setErrNo', '$ERRNO_CODES'],
  pause: function() {
    // int pause(void);
    // http://pubs.opengroup.org/onlinepubs/000095399/functions/pause.html
    // We don't support signals, so we return immediately.
    Module.printErr('Calling stub instead of pause()');
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
  //bsd_signal
  //sysv_signal
  //pthread_kill
  //gsignal
  //ssignal
  //sigpause
  //sigtimedwait
  //sigwaitinfo
  //sigreturn
  //sigstack
  //sigsetops(3),
};

mergeInto(LibraryManager.library, funs);
