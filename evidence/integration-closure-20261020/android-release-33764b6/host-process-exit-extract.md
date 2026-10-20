# Exact host health samples at QEMU disappearance

```text
2026-10-20T00:12:47Z
               total        used        free      shared  buff/cache   available
Mem:           15989        6506         196         146        9779        9482
Swap:           3071           0        3071
    PID COMMAND           RSS %CPU
   4966 qemu-system-x86 5576228 251
   5071 adb              8504  0.9
   5174 adb              5592  0.3
   5175 adb              5496  0.0
   6212 node            119464 1.3
2026-10-20T00:12:49Z
               total        used        free      shared  buff/cache   available
Mem:           15989        6513         223         146        9745        9475
Swap:           3071           0        3071
    PID COMMAND           RSS %CPU
   4966 qemu-system-x86 5576228 248
   5071 adb              8504  0.9
   5174 adb              5592  0.3
   5175 adb              5496  0.0
   6212 node            119484 1.3
2026-10-20T00:12:51Z
               total        used        free      shared  buff/cache   available
Mem:           15989        6515        4327         146        5640        9474
Swap:           3071           0        3071
    PID COMMAND           RSS %CPU
   4966 qemu-system-x86 5576228 246
   5071 adb              8504  0.8
   5174 adb              5592  0.3
   5175 adb              5496  0.0
   6212 node            119572 1.2
2026-10-20T00:12:53Z
               total        used        free      shared  buff/cache   available
Mem:           15989        1117       11969          50        3300       14871
Swap:           3071           0        3071
    PID COMMAND           RSS %CPU
   5071 adb              8500  0.8
   5175 adb              5496  0.0
   6212 node            119592 1.2
2026-10-20T00:12:55Z
               total        used        free      shared  buff/cache   available
Mem:           15989        1115       11971          50        3300       14874
Swap:           3071           0        3071
    PID COMMAND           RSS %CPU
```

The process is absent before acceptance cleanup. The exit cause is not captured.
