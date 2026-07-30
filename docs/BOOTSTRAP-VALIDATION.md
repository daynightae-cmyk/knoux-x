# Bootstrap validation

The repository workflow validates `scripts/Initialize-KnouxX.ps1` on a Windows runner using the native PowerShell parser.

The validation checks:

- PowerShell syntax and tokenization.
- Required default ZIP and repository values.
- Presence of the dedicated bootstrap branch strategy.
- Presence of the Electron `safeStorage` requirement.
- Absence of common GitHub token prefixes and private-key markers.

This validation does not execute the bootstrap because execution requires the local source archive at `D:\Knoux-x.zip` and authenticated Git credentials.
