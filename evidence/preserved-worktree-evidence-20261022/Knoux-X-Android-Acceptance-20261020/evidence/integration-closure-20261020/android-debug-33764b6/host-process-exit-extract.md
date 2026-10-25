# Exact host health samples at QEMU disappearance

```text
2026-10-20T00:12:55Z
               total        used        free      shared  buff/cache   available
Mem:           15989        6551         280         151        9655        9437
Swap:           3071           0        3071
    PID COMMAND           RSS %CPU
   4815 qemu-system-x86 5639004 246
   4845 adb                 0  0.0
   4853 adb                 0  0.0
   4865 adb                 0  0.0
   4934 adb              8540  0.9
   5028 adb              5524  0.4
   5029 adb              5468  0.0
   6113 node            118068 1.3
2026-10-20T00:12:57Z
               total        used        free      shared  buff/cache   available
Mem:           15989        6554         209         151        9724        9435
Swap:           3071           0        3071
    PID COMMAND           RSS %CPU
   4815 qemu-system-x86 5639004 243
   4845 adb                 0  0.0
   4853 adb                 0  0.0
   4865 adb                 0  0.0
   4934 adb              8540  0.9
   5028 adb              5524  0.4
   5029 adb              5468  0.0
   6113 node            118068 1.3
2026-10-20T00:12:59Z
               total        used        free      shared  buff/cache   available
Mem:           15989        6563         235         151        9689        9426
Swap:           3071           0        3071
    PID COMMAND           RSS %CPU
   4815 qemu-system-x86 5639004 241
   4845 adb                 0  0.0
   4853 adb                 0  0.0
   4865 adb                 0  0.0
   4934 adb              8540  0.9
   5028 adb              5524  0.4
   5029 adb              5468  0.0
   6113 node            118036 1.3
2026-10-20T00:13:01Z
               total        used        free      shared  buff/cache   available
Mem:           15989        1136       12077          50        3172       14853
Swap:           3071           0        3071
    PID COMMAND           RSS %CPU
   4934 adb              8540  0.9
   5029 adb              5468  0.0
   6113 node            118708 1.2
   6537 adb              5448  0.0
2026-10-20T00:13:03Z
```

The process is absent before acceptance cleanup. The exit cause is not captured.
