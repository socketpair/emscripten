#include "syscall.h"

extern long __restore(void);

long __restore(void) {
    return syscall(SYS_sigreturn);
}

extern long __restore_rt(void);

long __restore_rt(void) {
    return syscall(SYS_rt_sigreturn);
}
