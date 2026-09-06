@echo off
rem Windows 版のランチャ。bin/ui-chan-node（sh）と同じ役割で、
rem node を見つけて、渡された引数のまま起動する。
rem
rem クライアントの設定にはこのファイルの絶対パスが書かれる。Windows は
rem launchd のような PATH の欠落こそ無いが、GUI から起動されたアプリが
rem ユーザーの PATH を持っているとは限らないので、よく使う場所も見る。
setlocal
where node >nul 2>nul
if %ERRORLEVEL%==0 (
  node %*
  exit /b %ERRORLEVEL%
)
for %%P in (
  "%ProgramFiles%\nodejs\node.exe"
  "%ProgramFiles(x86)%\nodejs\node.exe"
  "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  "%LOCALAPPDATA%\fnm_multishells\node.exe"
  "%APPDATA%\nvm\node.exe"
) do (
  if exist %%P (
    %%P %*
    exit /b %ERRORLEVEL%
  )
)
echo [ui-chan] node が見つかりません。node をインストールするか、PATH を通してください。 1>&2
exit /b 127
