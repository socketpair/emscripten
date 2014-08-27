#define __SYSCALL_LL_E(x) \
((union { long long ll; long l[2]; }){ .ll = x }).l[0], \
((union { long long ll; long l[2]; }){ .ll = x }).l[1]
#define __SYSCALL_LL_O(x) 0, __SYSCALL_LL_E((x))

/*
    Unfortunatelly we intentionally not move __emulate_syscall() to searate file.
    If we do that we will prevent Clang/llvm optimizer from throwing unused syscalls
    references when someone call SYSCALLN(....).
*/

#include "syscall_emulation.h"

static __inline long __syscall0(long n)
{
    return __emulate_syscall(n, 0, 0, 0, 0, 0, 0);
}

static __inline long __syscall1(long n, long a1)
{
    return __emulate_syscall(n, a1, 0, 0, 0, 0, 0);
}

static __inline long __syscall2(long n, long a1, long a2)
{
    return __emulate_syscall(n, a1, a2, 0, 0, 0, 0);
}

static __inline long __syscall3(long n, long a1, long a2, long a3)
{
    return __emulate_syscall(n, a1, a2, a3, 0, 0, 0);
}

static __inline long __syscall4(long n, long a1, long a2, long a3, long a4)
{
    return __emulate_syscall(n, a1, a2, a3, a4, 0, 0);
}

static __inline long __syscall5(long n, long a1, long a2, long a3, long a4, long a5)
{
    return __emulate_syscall(n, a1, a2, a3, a4, a5, 0);
}

static __inline long __syscall6(long n, long a1, long a2, long a3, long a4, long a5, long a6) {
    return __emulate_syscall(n, a1, a2, a3, a4, a5, a6);
}
