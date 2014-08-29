
static void queue_signal(long sig) {

}


extern long kill(long sig, long sig);
long SYS_kill(long pid, long sig) {
    pid_t mypid;

    if (sig < 1 || sig > 31 ) {
      return -EINVAL;
    }

    if (pid == -1) {
      // Linux does not signal itself on that call.
      // No other processes exists, so ESRCH :)
        return -ESRCH;
    }


    // TODO: call SYS_getpid() whe it will be implemented as syscall :)
    mypid = getpid();

    if (pid < 0) {
      // we are only one process on our group
      pid = -pid;
    }

    if (pid && (pid != mypid)) {
        return -ESRCH;
    }

    SIG.queue_signal(sig);
    return 0;
}

