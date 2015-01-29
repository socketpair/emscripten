#include <unistd.h> // _exit

// COPY+PASTE from musl/src/internal/ksigaction.h
struct k_sigaction {
        void (*handler)(int);
        unsigned long flags;
        void (*restorer)(void);
        unsigned mask[2];
};


static sigset_t pending; // should be flled wit zeros at compile state
static sigset_t mask; // list of ALLOWED signals. TODO: how to allow all
static k_sigaction kernel_sigactions[_NSIG]; // TODO: fill with SIG_DFL

typedef void (*dfl_handler_type)(void);

static void terminate(void) { _exit(42); }
static void core(void) { _exit(43); }
static void ignore(void) { ; }
static void cont(void) { ; }
static void stop(void) { _exit(44); } // TODO: ignore really, + print message

const static dfl_handler_type dfl_handers[_NSIG] = {
      null,
      terminate,  // SIGHUP       1
      terminate,  // SIGINT       2
      core,       // SIGQUIT      3
      core,       // SIGILL       4
      core,       // SIGTRAP      5
      core,       // SIGABRT      6
      core,       // SIGBUS       7
      core,       // SIGFPE       8
      terminate,  // SIGKILL      9
      terminate,  // SIGUSR1      10
      core,       // SIGSEGV      11
      terminate,  // SIGUSR2      12
      terminate,  // SIGPIPE      13
      terminate,  // SIGALRM      14
      terminate,  // SIGTERM      15
      terminate,  // SIGSTKFLT    16
      ignore,     // SIGCHLD      17
      cont,       // SIGCONT      18
      stop,       // SIGSTOP      19
      stop,       // SIGTSTP      20
      stop,       // SIGTTIN      21
      stop,       // SIGTTOU      22
      ignore,     // SIGURG       23
      core,       // SIGXCPU      24
      core,       // SIGXFSZ      25
      terminate,  // SIGVTALRM    26
      terminate,  // SIGPROF      27
      ignore,     // SIGWINCH     28
      terminate,  // SIGIO        29
      terminate,  // SIGPWR       30
      core        // SIGSYS       31
};

static void call_signal_handler(long i) {
    const struct k_sigaction* ksa = kernel_sigactions[i];
    if (ksa->sa_handler == SIG_IGN) {
        ignore();
        return;
    }
    if (ksa->sa_handler == SIG_DFL) {
        (dfl_handers[i])();
        return;
    }
    // TODO: handlesa_sigaction and also flags
    ksa->sa_handler(i);
}

static void call_signal_handlers(void) {
    sigset_t active;
    int i;
    // TODO: do that only once, and control every where.

    sigaddset(&mask, SIGKILL);
    sigaddset(&mask, SIGSTOP);

again:
    sigandset(&active, &mask, &pending);
    for(i=0; i<_NSIG; i++) {
        if (!sigismember(&active, i))
            continue;
        sigdelset(&pending, i);
        // TODO: SIGBLOCK(i); -- depending on sigaction flag...
        call_signal_handler(i);
        // TODO: SIGUNBLOCK(i);

        // current_sigmask may have been changed...recalculate
        goto again;
    }
}

extern long kill(long sig, long sig);
long SYS_kill(long pid, long sig) {
    pid_t mypid;

    if (sig < 1 || sig >= _NSIG ) {
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

    if (sig == 0) {
        return 0;
    }

    SIG.queue_signal(sig);
    return 0;
}
