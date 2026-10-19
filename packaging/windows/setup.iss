#ifndef AppVersion
  #error AppVersion must be supplied by the build script
#endif

[Setup]
AppId={code:SetupId}
AppName=Suno Beast
AppVersion={#AppVersion}
AppPublisher=Lotargo
AppPublisherURL=https://github.com/Lotargo/suno_beast
DefaultDirName={localappdata}\Programs\SunoBeast
DefaultGroupName=Suno Beast
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=Suno-Beast-v{#AppVersion}-Windows-x64-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UsePreviousLanguage=no
DisableProgramGroupPage=yes
AllowNoIcons=yes
CloseApplications=no
RestartApplications=no
LicenseFile={#SourceDir}\LICENSE
SetupIconFile={#SourceDir}\app.ico
UninstallDisplayName=Suno Beast
UninstallDisplayIcon={app}\app.ico

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
russian.OpenGuide=Открыть инструкцию подключения расширения
english.OpenGuide=Open browser extension setup instructions
russian.GuideShortcut=Подключить расширение в браузере
english.GuideShortcut=Set up the browser extension
russian.Conflict=Помощник Suno Beast уже подключён из другой папки:%n%1%n%nЗавершите запись и удалите регистрацию помощника из прежней копии. Затем повторите установку. Другие установки не будут изменены.
english.Conflict=The Suno Beast helper is already registered from another folder:%n%1%n%nFinish recording and remove the old helper registration, then retry setup. Other installations will not be changed.
russian.Occupied=Выберите пустую папку или папку программы, ранее установленной этим установщиком. Существующие файлы и папки с исходниками не будут перезаписаны.
english.Occupied=Choose an empty folder or a program folder previously created by this installer. Existing files and source checkouts will not be overwritten.
russian.CheckFailed=Не удалось проверить встроенные компоненты. Установка отменена. Повторите установку и проверьте журнал.
english.CheckFailed=Bundled component verification failed. Installation was cancelled. Retry setup and check its log.

[Files]
Source: "{#SourceDir}\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\native\*"; DestDir: "{app}\native"; Flags: ignoreversion
Source: "{#SourceDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "{#SourceDir}\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\app.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\runtime-info.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\installer-scope.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\GettingStarted.txt"; DestDir: "{app}"; Flags: ignoreversion; AfterInstall: PrepareHelper

[Registry]
Root: HKCU; Subkey: "{code:RegistryBase}\Google\Chrome\NativeMessagingHosts\com.sunobeast.audio"; ValueType: string; ValueName: ""; ValueData: "{app}\native\com.sunobeast.audio.json"
Root: HKCU; Subkey: "{code:RegistryBase}\Microsoft\Edge\NativeMessagingHosts\com.sunobeast.audio"; ValueType: string; ValueName: ""; ValueData: "{app}\native\com.sunobeast.audio.json"

[Icons]
Name: "{group}\{cm:GuideShortcut}"; Filename: "{app}\GettingStarted.txt"
Name: "{group}\Uninstall Suno Beast"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\GettingStarted.txt"; Description: "{cm:OpenGuide}"; Flags: shellexec postinstall skipifsilent

[Code]
var ScopeId: String;

function ValidScope(Value: String): Boolean;
var I: Integer;
begin
  Result := (Value = '') or (Length(Value) = 32);
  if Result then
    for I := 1 to Length(Value) do
      if Pos(Value[I], '0123456789abcdef') = 0 then Result := False;
end;

function SetupId(Param: String): String;
begin
  ScopeId := ExpandConstant('{param:SBTESTID|}');
  if not ValidScope(ScopeId) then RaiseException('Invalid isolated test ID');
  Result := 'SunoBeast';
  if ScopeId <> '' then Result := Result + '-Test-' + ScopeId;
end;

function RegistryBase(Param: String): String;
begin
  Result := 'Software';
  if ScopeId <> '' then Result := Result + '\SunoBeastInstallerTests\' + ScopeId;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Current, Expected, Key: String; I: Integer; FindRec: TFindRec;
begin
  Result := '';
  if DirExists(ExpandConstant('{app}\.git')) or FileExists(ExpandConstant('{app}\.git')) then begin
    Result := CustomMessage('Occupied');
    Exit;
  end;
  if not (FileExists(ExpandConstant('{app}\installer-scope.txt')) and FileExists(ExpandConstant('{app}\unins000.exe'))) then
    if FindFirst(ExpandConstant('{app}\*'), FindRec) then begin
      try
        repeat
          if (FindRec.Name <> '.') and (FindRec.Name <> '..') then Result := CustomMessage('Occupied');
        until not FindNext(FindRec);
      finally FindClose(FindRec); end;
      if Result <> '' then Exit;
    end;
  Expected := ExpandConstant('{app}\native\com.sunobeast.audio.json');
  for I := 0 to 1 do begin
    if I = 0 then Key := RegistryBase('') + '\Google\Chrome'
    else Key := RegistryBase('') + '\Microsoft\Edge';
    Key := Key + '\NativeMessagingHosts\com.sunobeast.audio';
    if RegQueryStringValue(HKCU, Key, '', Current) and (Current <> '') and (CompareText(Current, Expected) <> 0) then
      Result := FmtMessage(CustomMessage('Conflict'), [Current]);
  end;
end;

function JsonPath(Value: String): String;
begin
  StringChangeEx(Value, '\', '\\', True);
  StringChangeEx(Value, '"', '\"', True);
  Result := Value;
end;

procedure PrepareHelper;
var Manifest, Guide, AppPath: String; GuideUtf8: AnsiString; ExitCode: Integer;
begin
  AppPath := ExpandConstant('{app}');
  Manifest := '{"name":"com.sunobeast.audio","description":"Suno Beast audio helper","type":"stdio","path":"' +
    JsonPath(AppPath + '\native\launch-host.cmd') + '","allowed_origins":["chrome-extension://{#ExtensionId}/"]}';
  if not SaveStringToFile(AppPath + '\native\com.sunobeast.audio.json', UTF8Encode(Manifest), False) then RaiseException(CustomMessage('CheckFailed'));
  if not SaveStringToFile(AppPath + '\installer-scope.txt', ScopeId, False) then RaiseException(CustomMessage('CheckFailed'));
  Guide := 'Suno Beast' + #13#10 + #13#10 +
    'Node.js, FFmpeg and ffprobe are included. No additional downloads are needed.' + #13#10 + #13#10 +
    '1. Open your browser extensions page:' + #13#10 +
    '   Chrome: chrome://extensions' + #13#10 + '   Edge: edge://extensions' + #13#10 +
    '   Yandex: browser://extensions' + #13#10 + '   Opera / Opera GX: opera://extensions (experimental)' + #13#10 +
    '2. Enable Developer mode and choose Load unpacked.' + #13#10 +
    '3. Select this folder:' + #13#10 + AppPath + '\extension' + #13#10 +
    '4. Pin Suno Beast, open https://suno.com and click its toolbar button.' + #13#10 + #13#10 +
    'Before updating or uninstalling, finish recording and close browsers using Suno Beast.' + #13#10 +
    'After updating, reopen the browser and reload Suno Beast on the extensions page.' + #13#10 +
    'Uninstalling preserves recordings, settings and the collection index.' + #13#10;
  if ActiveLanguage = 'russian' then
    Guide := 'Suno Beast — подключение расширения' + #13#10 + #13#10 +
      'Всё необходимое уже установлено. Отдельно устанавливать Node.js и FFmpeg не нужно.' + #13#10 + #13#10 +
      '1. Откройте страницу расширений в браузере:' + #13#10 +
      '   Chrome: chrome://extensions' + #13#10 + '   Edge: edge://extensions' + #13#10 +
      '   Яндекс: browser://extensions' + #13#10 + '   Opera / Opera GX: opera://extensions (экспериментально)' + #13#10 +
      '2. Включите «Режим разработчика» и нажмите «Загрузить распакованное расширение».' + #13#10 +
      '3. Выберите папку:' + #13#10 + AppPath + '\extension' + #13#10 +
      '4. Закрепите Suno Beast на панели браузера, откройте https://suno.com и нажмите его кнопку.' + #13#10 + #13#10 +
      'После обновления нажмите перезагрузку карточки Suno Beast на странице расширений.' + #13#10 +
      'Перед обновлением или удалением завершите запись и закройте браузеры с Suno Beast.' + #13#10 +
      'Удаление программы сохраняет записи, настройки и индекс коллекции.' + #13#10;
  GuideUtf8 := UTF8Encode(#$FEFF + Guide);
  if not SaveStringToFile(AppPath + '\GettingStarted.txt', GuideUtf8, False) then RaiseException(CustomMessage('CheckFailed'));
  if not Exec(AppPath + '\runtime\node.exe', '"' + AppPath + '\native\self-check.js"', AppPath, SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
    RaiseException(CustomMessage('CheckFailed'));
end;

function InitializeUninstall: Boolean;
var Saved: AnsiString;
begin
  Result := LoadStringFromFile(ExpandConstant('{app}\installer-scope.txt'), Saved);
  if Result then begin
    ScopeId := Trim(String(Saved));
    Result := ValidScope(ScopeId);
  end;
  if not Result then MsgBox('Cannot verify the installation scope. Uninstall was cancelled.', mbError, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var I: Integer; Key, Current, Expected: String;
begin
  if CurUninstallStep = usUninstall then begin
    Expected := ExpandConstant('{app}\native\com.sunobeast.audio.json');
    for I := 0 to 1 do begin
      if I = 0 then Key := RegistryBase('') + '\Google\Chrome' else Key := RegistryBase('') + '\Microsoft\Edge';
      Key := Key + '\NativeMessagingHosts\com.sunobeast.audio';
      if RegQueryStringValue(HKCU, Key, '', Current) and (CompareText(Current, Expected) = 0) then begin
        RegDeleteValue(HKCU, Key, '');
        RegDeleteKeyIfEmpty(HKCU, Key);
      end;
    end;
  end;
end;
