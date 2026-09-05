#define MyAppName "OPUS-COPY"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Mulvin"
#define MyAppURL "https://github.com/contatomulvin-bot/OPUS-COPY"

[Setup]
AppId={{7E2CB08A-95B8-4C45-B4B4-49D87B0B0D17}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
DefaultDirName={localappdata}\Programs\OPUS-COPY
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=OPUS-COPY-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UninstallDisplayName=OPUS-COPY

[Files]
Source: "..\install.ps1"; Flags: dontcopy

[Icons]
Name: "{autodesktop}\OPUS-COPY"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\app\desktop\run.ps1"""; WorkingDir: "{app}\app"; Comment: "Abrir OPUS-COPY"
Name: "{userprograms}\OPUS-COPY"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\app\desktop\run.ps1"""; WorkingDir: "{app}\app"; Comment: "Abrir OPUS-COPY"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\app\desktop\run.ps1"""; WorkingDir: "{app}\app"; Description: "Abrir OPUS-COPY"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  ScriptPath: String;
  Parameters: String;
begin
  Result := '';
  ExtractTemporaryFile('install.ps1');
  ScriptPath := ExpandConstant('{tmp}\install.ps1');
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' + ScriptPath +
    '" -InstallPath "' + ExpandConstant('{app}\app') + '" -SkipLaunch';

  if not Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Parameters,
    '',
    SW_SHOW,
    ewWaitUntilTerminated,
    ResultCode
  ) then
    Result := 'Não foi possível iniciar o instalador automático do OPUS-COPY.'
  else if ResultCode <> 0 then
    Result := 'A instalação dos componentes do OPUS-COPY falhou. Código: ' + IntToStr(ResultCode) + '.';
end;
