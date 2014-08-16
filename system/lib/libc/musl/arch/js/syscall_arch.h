#include <emscripten.h>

#define __SYSCALL_LL_E(x) \
((union { long long ll; long l[2]; }){ .ll = x }).l[0], \
((union { long long ll; long l[2]; }){ .ll = x }).l[1]
#define __SYSCALL_LL_O(x) 0, __SYSCALL_LL_E((x))

static __inline long __syscall0(long n)
{
    return EM_ASM_INT({ syscall0($0); }, n);
}

static __inline long __syscall1(long n, long a1)
{
    return EM_ASM_INT({ syscall0($0, $1); }, n, a1);
}

static __inline long __syscall2(long n, long a1, long a2)
{
    return EM_ASM_INT({ syscall0($0, $1, $2); }, n, a1, a2);
}

static __inline long __syscall3(long n, long a1, long a2, long a3)
{
    return EM_ASM_INT({ syscall0($0, $1, $2, $3); }, n, a1, a2, a3);
}

static __inline long __syscall4(long n, long a1, long a2, long a3, long a4)
{
    return EM_ASM_INT({ syscall0($0, $1, $2, $3, $4); }, n, a1, a2, a3, a4);
}

static __inline long __syscall5(long n, long a1, long a2, long a3, long a4, long a5)
{
    return EM_ASM_INT({ syscall0($0, $1, $2, $3, $4, $5); }, n, a1, a2, a3, a4, a5);
}

static __inline long __syscall6(long n, long a1, long a2, long a3, long a4, long a5, long a6)
{
    return EM_ASM_INT({ syscall0($0, $1, $2, $3, $4, $5, $6); }, n, a1, a2, a3, a4, a5, a6);
}
