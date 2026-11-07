# Book Compare helper - shows the Windows "choose a folder" window.
# Started by serve.ps1 as a separate small program, so that a problem in this window can never stop Book Compare itself.
# The result is written to the file named in BC_PICK_OUT. Exit code: 0 = a folder was chosen, 1 = cancelled, 2 = failed.
$ErrorActionPreference = 'Stop'
$start = $env:BC_PICK_START
$title = $env:BC_PICK_TITLE
$out   = $env:BC_PICK_OUT
if (-not $title) { $title = 'Choose a folder' }

function Write-Result([string]$text) {
  if ($out) { [System.IO.File]::WriteAllText($out, $text, (New-Object System.Text.UTF8Encoding($false))) }
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $owner = New-Object System.Windows.Forms.Form
  $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.StartPosition = 'Manual'
  $owner.Location = New-Object System.Drawing.Point(-2000, -2000); $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.Show(); $owner.Activate()
} catch {
  Write-Result ('cannot create window: ' + $_.Exception.Message); exit 2
}

# Brings the folder window to the front. This program runs hidden in the background, and Windows normally does NOT let such a program
# put a window in front of the browser the person is looking at (the window then opens behind it). So, a moment after the window
# has opened, a small watcher makes it a top window, asks Windows for the keyboard focus, and takes the top-window state off again.
$frontCode = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
namespace BookCompare {
  public static class Front {
    private delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

    // the visible window of this program that is not the small invisible owner window
    private static IntPtr FindDialog(uint pid) {
      IntPtr found = IntPtr.Zero;
      EnumWindows(delegate(IntPtr h, IntPtr l) {
        uint p; GetWindowThreadProcessId(h, out p);
        if (p != pid || !IsWindowVisible(h)) return true;
        StringBuilder c = new StringBuilder(128); GetClassName(h, c, 128);
        if (c.ToString().StartsWith("WindowsForms")) return true;      // our own invisible owner window
        found = h; return false;
      }, IntPtr.Zero);
      return found;
    }
    private static void Raise(IntPtr h) {
      IntPtr topmost = new IntPtr(-1);
      SetWindowPos(h, topmost, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);                 // top of everything (no move, no resize, show)
      mouse_event(0x0001, 0, 0, 0, UIntPtr.Zero);                                      // an input event that moves nothing: Windows then lets this program take the focus
      IntPtr fg = GetForegroundWindow();
      uint fgThread = (fg == IntPtr.Zero) ? 0 : GetWindowThreadProcessId(fg, IntPtr.Zero);
      uint me = GetCurrentThreadId();
      bool attached = (fgThread != 0 && fgThread != me) && AttachThreadInput(me, fgThread, true);
      SetForegroundWindow(h); BringWindowToTop(h);
      if (attached) AttachThreadInput(me, fgThread, false);
    }
    private static void Watch() {
      try {
        uint pid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        int tries = 0, calm = 0;
        for (int i = 0; i < 100 && calm < 4; i++) {
          Thread.Sleep(60);
          IntPtr h = FindDialog(pid);
          if (h == IntPtr.Zero) continue;
          if (GetForegroundWindow() == h) {
            SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);   // not a top window any more (it stays on top of the browser)
            calm++;
          } else if (tries < 25) { tries++; Raise(h); }
        }
      } catch (Exception) { }
    }
    // call before the folder window is shown: starts the watcher
    public static void Start() { Thread t = new Thread(Watch); t.IsBackground = true; t.Start(); }
  }
}
'@

# The modern Windows window (address bar, favourites, search). It is called through a small piece of code that is compiled here.
$code = @'
using System;
using System.Runtime.InteropServices;
namespace BookCompare {
  public static class FolderPicker {
    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] private class FileOpenDialogCoClass { }
    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
      void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
      void GetParent(out IShellItem ppsi);
      void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
      void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
      void Compare(IShellItem psi, uint hint, out int piOrder);
    }
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog {
      [PreserveSig] int Show(IntPtr parent);
      void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
      void SetFileTypeIndex(uint iFileType);
      void GetFileTypeIndex(out uint piFileType);
      void Advise(IntPtr pfde, out uint pdwCookie);
      void Unadvise(uint dwCookie);
      void SetOptions(uint fos);
      void GetOptions(out uint pfos);
      void SetDefaultFolder(IShellItem psi);
      void SetFolder(IShellItem psi);
      void GetFolder(out IShellItem ppsi);
      void GetCurrentSelection(out IShellItem ppsi);
      void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
      void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
      void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
      void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
      void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
      void GetResult(out IShellItem ppsi);
      void AddPlace(IShellItem psi, int fdap);
      void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
      void Close(int hr);
      void SetClientGuid(ref Guid guid);
      void ClearClientData();
      void SetFilter(IntPtr pFilter);
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

    // For the automatic Windows test only: prepares the window like Pick does, without showing it.
    public static string Selftest(string startFolder) {
      IFileDialog dlg = (IFileDialog)new FileOpenDialogCoClass();
      uint opts; dlg.GetOptions(out opts);
      dlg.SetOptions(opts | 0x20 | 0x40 | 0x800);
      uint after; dlg.GetOptions(out after);
      dlg.SetTitle("Book Compare self test");
      if (!string.IsNullOrEmpty(startFolder) && System.IO.Directory.Exists(startFolder)) {
        Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
        IShellItem item;
        SHCreateItemFromParsingName(startFolder, IntPtr.Zero, ref iid, out item);
        dlg.SetFolder(item);
      }
      return ((after & 0x20) != 0) ? "ok" : "options were not set";
    }

    // Returns the chosen folder, or null if the window was cancelled. Throws if the window could not be shown.
    public static string Pick(IntPtr owner, string startFolder, string title) {
      IFileDialog dlg = (IFileDialog)new FileOpenDialogCoClass();
      uint opts; dlg.GetOptions(out opts);
      dlg.SetOptions(opts | 0x20 | 0x40 | 0x800);          // pick folders, real folders only, the folder must exist
      if (!string.IsNullOrEmpty(title)) dlg.SetTitle(title);
      if (!string.IsNullOrEmpty(startFolder) && System.IO.Directory.Exists(startFolder)) {
        Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
        IShellItem item;
        SHCreateItemFromParsingName(startFolder, IntPtr.Zero, ref iid, out item);
        dlg.SetFolder(item);
      }
      int hr = dlg.Show(owner);
      if (hr == unchecked((int)0x800704C7)) return null;   // cancelled
      if (hr != 0) Marshal.ThrowExceptionForHR(hr);
      IShellItem res; dlg.GetResult(out res);
      string path; res.GetDisplayName(0x80058000, out path);  // the folder as a normal path
      return path;
    }
  }
}
'@

$chosen = $null; $cancelled = $false; $modernFailed = $null
if ($env:BC_PICK_SELFTEST -eq '1') {                                # automatic Windows test: check the window code without showing a window
  try { Add-Type -TypeDefinition $frontCode; Add-Type -TypeDefinition $code; Write-Result ([BookCompare.FolderPicker]::Selftest($start)); exit 0 }
  catch { Write-Result ('self test failed: ' + $_.Exception.Message); exit 2 }
}
$haveFront = $false
try { Add-Type -TypeDefinition $frontCode; $haveFront = $true } catch { }        # if this fails the window still works, it just may open behind the browser
try {
  Add-Type -TypeDefinition $code
  if ($haveFront) { [BookCompare.Front]::Start() }
  $chosen = [BookCompare.FolderPicker]::Pick($owner.Handle, $start, $title)
  if (-not $chosen) { $cancelled = $true }
} catch {
  $modernFailed = $_.Exception.Message
}

if ($modernFailed) {
  # fall back to the older, simpler window
  try {
    if ($haveFront) { [BookCompare.Front]::Start() }
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = $title
    $dlg.ShowNewFolderButton = $false
    if ($start -and (Test-Path -LiteralPath $start -PathType Container)) { $dlg.SelectedPath = $start }
    $r = $dlg.ShowDialog($owner)
    if ($r -eq [System.Windows.Forms.DialogResult]::OK -and $dlg.SelectedPath) { $chosen = $dlg.SelectedPath } else { $cancelled = $true }
  } catch {
    Write-Result ('folder window failed: ' + $modernFailed + ' / ' + $_.Exception.Message); exit 2
  }
}
try { $owner.Close() } catch { }
if ($cancelled -or -not $chosen) { Write-Result ''; exit 1 }
Write-Result $chosen
exit 0
