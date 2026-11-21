# Tells Docket when Windows is about to sleep, hibernate or shut down, and when it wakes.
# Started hidden by server.mjs; prints one word per line: sleep, wake or shutdown. Node cannot hear these
# itself. SystemEvents needs a message loop for SessionEnding, so this runs one (Application.Run).
# It ends by itself when the Docket app that started it (-ParentPid) is gone.
param([int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Windows.Forms;
using Microsoft.Win32;
public static class DocketPowerWatch {
  static void Say(string word) { Console.Out.WriteLine(word); Console.Out.Flush(); }
  public static void Run(int parentPid) {
    SystemEvents.PowerModeChanged += (s, e) => {
      if (e.Mode == PowerModes.Suspend) Say("sleep");
      else if (e.Mode == PowerModes.Resume) Say("wake");
    };
    SystemEvents.SessionEnding += (s, e) => Say("shutdown");
    var timer = new Timer { Interval = 10000 };
    timer.Tick += (s, e) => {
      if (parentPid <= 0) return;
      try { if (Process.GetProcessById(parentPid).HasExited) Application.Exit(); } catch { Application.Exit(); }
    };
    timer.Start();
    Say("ready");
    Application.Run();
  }
}
'@
[DocketPowerWatch]::Run($ParentPid)
