# Instalador Windows

O `OPUS-COPY-Setup.exe` é um instalador online por usuário. Ele executa o `install.ps1`, verifica as dependências, baixa o repositório, prepara o ambiente e cria atalhos.

## Compilar localmente

1. Instale o [Inno Setup 6](https://jrsoftware.org/isinfo.php).
2. Na raiz do repositório, execute:

```powershell
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" ".\installer\OPUS-COPY.iss"
```

Saída:

```text
installer\output\OPUS-COPY-Setup.exe
```

O workflow `windows-installer.yml` valida o PowerShell, compila o instalador e publica uma versão atualizada no release `installer-latest`.
