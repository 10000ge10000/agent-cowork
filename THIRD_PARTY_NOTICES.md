# Third Party Notices

Agent Cowork bundles selected third-party runtime components so Windows users can run the app without manually installing system dependencies.

## Git for Windows Portable Runtime

- Component: PortableGit for Windows x64
- Version: 2.54.0.windows.1
- Source: https://github.com/git-for-windows/git/releases/tag/v2.54.0.windows.1
- Bundled path in packaged app: `resources/git`
- Purpose: provides Git Bash (`bash.exe`) required by Claude Code on Windows.

PortableGit includes Git, Bash, MSYS2 runtime components, and related command-line tools under their respective upstream licenses, including GPL/LGPL licensed components. The original license and notice files are preserved inside the bundled `resources/git` directory, including `LICENSE.txt` and `README.portable`.

The Agent Cowork application code remains licensed according to this project's own license. The bundled Git for Windows runtime is redistributed under its upstream licenses.
