using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Knoux.VisualInstaller
{
    internal static class EmbeddedAssets
    {
        internal const string SetupResource = "Knoux.Payload.Setup.exe";
        internal static readonly string[] SlideResources = Enumerable.Range(1, 9)
            .Select(delegate(int index) { return "Knoux.Slide." + index.ToString("00") + ".png"; })
            .ToArray();

        internal static Stream Open(string resourceName)
        {
            Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName);
            if (stream == null)
            {
                throw new InvalidOperationException("Embedded installer resource is missing: " + resourceName);
            }
            return stream;
        }

        internal static void Extract(string resourceName, string destination)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            using (Stream source = Open(resourceName))
            using (FileStream target = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                source.CopyTo(target);
                target.Flush(true);
            }
        }
    }

    internal static class InstallationRuntime
    {
        private const string ProductToken = "knoux";

        internal static string CreateTemporaryDirectory()
        {
            string directory = Path.Combine(Path.GetTempPath(), "KNOUX-Visual-Installer", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            return directory;
        }

        internal static string ExtractSetup(string directory)
        {
            string setupPath = Path.Combine(directory, "KNOUX-Player-X-Setup.exe");
            EmbeddedAssets.Extract(EmbeddedAssets.SetupResource, setupPath);
            if (!File.Exists(setupPath) || new FileInfo(setupPath).Length < 1024 * 1024)
            {
                throw new InvalidOperationException("Embedded Squirrel installer extraction failed.");
            }
            return setupPath;
        }

        internal static int RunSetup(string setupPath)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = setupPath;
            startInfo.Arguments = "--silent";
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            using (Process process = Process.Start(startInfo))
            {
                if (process == null) throw new InvalidOperationException("Squirrel installer could not be started.");
                if (!process.WaitForExit(240000))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("Squirrel installer did not finish within four minutes.");
                }
                return process.ExitCode;
            }
        }

        internal static string FindUpdateExecutable()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] preferred = new[]
            {
                Path.Combine(localAppData, "KNOUX_Player_X", "Update.exe"),
                Path.Combine(localAppData, "KNOUX Player X", "Update.exe"),
                Path.Combine(localAppData, "knoux-player-x", "Update.exe")
            };
            foreach (string candidate in preferred)
            {
                if (File.Exists(candidate)) return candidate;
            }

            try
            {
                foreach (string directory in Directory.GetDirectories(localAppData))
                {
                    if (Path.GetFileName(directory).IndexOf(ProductToken, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    string candidate = Path.Combine(directory, "Update.exe");
                    if (File.Exists(candidate)) return candidate;
                }
            }
            catch
            {
                // A locked unrelated LocalAppData directory must not block product detection.
            }
            return null;
        }

        internal static string FindInstalledApplication()
        {
            string updateExecutable = FindUpdateExecutable();
            if (String.IsNullOrEmpty(updateExecutable)) return null;
            string root = Path.GetDirectoryName(updateExecutable);
            try
            {
                string[] appDirectories = Directory.GetDirectories(root, "app-*")
                    .OrderByDescending(delegate(string value) { return value; }, StringComparer.OrdinalIgnoreCase)
                    .ToArray();
                foreach (string appDirectory in appDirectories)
                {
                    string direct = Path.Combine(appDirectory, "knoux-player-x.exe");
                    if (File.Exists(direct)) return direct;
                    string named = Path.Combine(appDirectory, "KNOUX Player X.exe");
                    if (File.Exists(named)) return named;
                    string first = Directory.GetFiles(appDirectory, "*.exe", SearchOption.TopDirectoryOnly)
                        .FirstOrDefault(delegate(string value)
                        {
                            return Path.GetFileName(value).IndexOf(ProductToken, StringComparison.OrdinalIgnoreCase) >= 0;
                        });
                    if (!String.IsNullOrEmpty(first)) return first;
                }
            }
            catch
            {
                return null;
            }
            return null;
        }

        internal static bool WaitForInstallation(bool installed, int timeoutMilliseconds)
        {
            Stopwatch stopwatch = Stopwatch.StartNew();
            while (stopwatch.ElapsedMilliseconds < timeoutMilliseconds)
            {
                bool current = !String.IsNullOrEmpty(FindInstalledApplication());
                if (current == installed) return true;
                Thread.Sleep(1000);
            }
            return !String.IsNullOrEmpty(FindInstalledApplication()) == installed;
        }

        internal static void LaunchInstalledApplication()
        {
            string updateExecutable = FindUpdateExecutable();
            string installedApplication = FindInstalledApplication();
            if (!String.IsNullOrEmpty(updateExecutable))
            {
                ProcessStartInfo updateStart = new ProcessStartInfo();
                updateStart.FileName = updateExecutable;
                updateStart.Arguments = "--processStart knoux-player-x.exe";
                updateStart.UseShellExecute = false;
                Process.Start(updateStart);
                return;
            }
            if (!String.IsNullOrEmpty(installedApplication))
            {
                Process.Start(new ProcessStartInfo(installedApplication) { UseShellExecute = true });
                return;
            }
            throw new InvalidOperationException("Installed KNOUX Player X executable was not found.");
        }

        internal static int Uninstall()
        {
            string updateExecutable = FindUpdateExecutable();
            if (String.IsNullOrEmpty(updateExecutable)) return 0;
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = updateExecutable;
            startInfo.Arguments = "--uninstall -s";
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            using (Process process = Process.Start(startInfo))
            {
                if (process == null) throw new InvalidOperationException("Squirrel uninstaller could not be started.");
                if (!process.WaitForExit(180000))
                {
                    try { process.Kill(); } catch { }
                    throw new TimeoutException("Squirrel uninstaller did not finish within three minutes.");
                }
                return process.ExitCode;
            }
        }

        internal static int InstallOrRepair()
        {
            string temporaryDirectory = CreateTemporaryDirectory();
            try
            {
                string setupPath = ExtractSetup(temporaryDirectory);
                int exitCode = RunSetup(setupPath);
                if (exitCode != 0) return exitCode;
                return WaitForInstallation(true, 180000) ? 0 : 91;
            }
            finally
            {
                try { Directory.Delete(temporaryDirectory, true); } catch { }
            }
        }
    }

    internal static class EvidenceMode
    {
        internal static string ArgumentValue(string[] args, string prefix)
        {
            string argument = args.FirstOrDefault(delegate(string value)
            {
                return value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
            });
            return argument == null ? null : argument.Substring(prefix.Length).Trim('"');
        }

        internal static void WriteEvidence(string destination, string mode, bool success, IList<string> details)
        {
            if (String.IsNullOrEmpty(destination)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(destination)));
            StringBuilder json = new StringBuilder();
            json.AppendLine("{");
            json.AppendLine("  \"product\": \"KNOUX Player X\",");
            json.AppendLine("  \"mode\": \"" + Escape(mode) + "\",");
            json.AppendLine("  \"success\": " + (success ? "true" : "false") + ",");
            json.AppendLine("  \"timestamp\": \"" + DateTime.UtcNow.ToString("O") + "\",");
            json.AppendLine("  \"details\": [");
            for (int index = 0; index < details.Count; index++)
            {
                json.Append("    \"").Append(Escape(details[index])).Append("\"");
                if (index + 1 < details.Count) json.Append(',');
                json.AppendLine();
            }
            json.AppendLine("  ]");
            json.AppendLine("}");
            File.WriteAllText(destination, json.ToString(), new UTF8Encoding(false));
        }

        private static string Escape(string value)
        {
            return (value ?? String.Empty)
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n");
        }

        internal static int SelfTest(string evidencePath)
        {
            List<string> details = new List<string>();
            try
            {
                using (Stream setup = EmbeddedAssets.Open(EmbeddedAssets.SetupResource))
                {
                    if (setup.Length < 1024 * 1024) throw new InvalidOperationException("Embedded setup payload is unexpectedly small.");
                    details.Add("setup-bytes=" + setup.Length);
                }
                foreach (string resource in EmbeddedAssets.SlideResources)
                {
                    using (Stream slide = EmbeddedAssets.Open(resource))
                    {
                        if (slide.Length < 1024) throw new InvalidOperationException("Installer slide is unexpectedly small: " + resource);
                        details.Add(resource + "=" + slide.Length);
                    }
                }
                details.Add("slides=9");
                details.Add("languages=en,ar");
                WriteEvidence(evidencePath, "self-test", true, details);
                return 0;
            }
            catch (Exception error)
            {
                details.Add(error.ToString());
                WriteEvidence(evidencePath, "self-test", false, details);
                return 1;
            }
        }

        internal static int InstallationTest(string mode, string evidencePath)
        {
            List<string> details = new List<string>();
            try
            {
                int exitCode;
                if (mode == "uninstall")
                {
                    exitCode = InstallationRuntime.Uninstall();
                    details.Add("uninstall-exit=" + exitCode);
                    bool removed = InstallationRuntime.WaitForInstallation(false, 180000);
                    details.Add("removed=" + removed);
                    WriteEvidence(evidencePath, mode, exitCode == 0 && removed, details);
                    return exitCode == 0 && removed ? 0 : 1;
                }

                bool existedBefore = !String.IsNullOrEmpty(InstallationRuntime.FindInstalledApplication());
                details.Add("installed-before=" + existedBefore);
                exitCode = InstallationRuntime.InstallOrRepair();
                details.Add("setup-exit=" + exitCode);
                string installed = InstallationRuntime.FindInstalledApplication();
                details.Add("installed-executable=" + (installed ?? String.Empty));
                bool success = exitCode == 0 && !String.IsNullOrEmpty(installed) && File.Exists(installed);
                WriteEvidence(evidencePath, mode, success, details);
                return success ? 0 : 1;
            }
            catch (Exception error)
            {
                details.Add(error.ToString());
                WriteEvidence(evidencePath, mode, false, details);
                return 1;
            }
        }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly List<Image> slides = new List<Image>();
        private readonly PictureBox slidePicture = new PictureBox();
        private readonly Label productLabel = new Label();
        private readonly Label titleLabel = new Label();
        private readonly Label descriptionLabel = new Label();
        private readonly Label statusLabel = new Label();
        private readonly Label slideCounter = new Label();
        private readonly Button languageButton = new Button();
        private readonly Button installButton = new Button();
        private readonly Button uninstallButton = new Button();
        private readonly Button launchButton = new Button();
        private readonly Button closeButton = new Button();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Timer carouselTimer = new Timer();
        private int slideIndex;
        private bool arabic;
        private bool busy;

        internal InstallerForm()
        {
            Text = "KNOUX Player X — Visual Installer";
            ClientSize = new Size(1120, 720);
            MinimumSize = new Size(980, 640);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(7, 5, 14);
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

            BuildLayout();
            LoadSlides();
            UpdateLanguage();
            UpdateInstallState();

            carouselTimer.Interval = 3300;
            carouselTimer.Tick += delegate { AdvanceSlide(); };
            carouselTimer.Start();
            FormClosed += delegate { DisposeSlides(); };
        }

        private void BuildLayout()
        {
            TableLayoutPanel root = new TableLayoutPanel();
            root.Dock = DockStyle.Fill;
            root.ColumnCount = 2;
            root.RowCount = 1;
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 66F));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34F));
            Controls.Add(root);

            Panel visualPanel = new Panel();
            visualPanel.Dock = DockStyle.Fill;
            visualPanel.Padding = new Padding(18);
            visualPanel.BackColor = Color.FromArgb(4, 3, 9);
            root.Controls.Add(visualPanel, 0, 0);

            slidePicture.Dock = DockStyle.Fill;
            slidePicture.SizeMode = PictureBoxSizeMode.Zoom;
            slidePicture.BackColor = Color.Black;
            visualPanel.Controls.Add(slidePicture);

            slideCounter.AutoSize = true;
            slideCounter.BackColor = Color.FromArgb(180, 10, 8, 20);
            slideCounter.ForeColor = Color.FromArgb(210, 200, 255);
            slideCounter.Padding = new Padding(10, 5, 10, 5);
            slideCounter.Location = new Point(30, 30);
            visualPanel.Controls.Add(slideCounter);
            slideCounter.BringToFront();

            Panel actionPanel = new Panel();
            actionPanel.Dock = DockStyle.Fill;
            actionPanel.Padding = new Padding(34, 28, 34, 28);
            actionPanel.BackColor = Color.FromArgb(13, 9, 24);
            root.Controls.Add(actionPanel, 1, 0);

            FlowLayoutPanel content = new FlowLayoutPanel();
            content.Dock = DockStyle.Fill;
            content.FlowDirection = FlowDirection.TopDown;
            content.WrapContents = false;
            content.AutoScroll = true;
            content.Padding = new Padding(0);
            actionPanel.Controls.Add(content);

            languageButton.Width = 92;
            languageButton.Height = 34;
            StyleButton(languageButton, Color.FromArgb(35, 24, 64), Color.FromArgb(143, 105, 255));
            languageButton.Click += delegate { arabic = !arabic; UpdateLanguage(); };
            content.Controls.Add(languageButton);

            productLabel.AutoSize = false;
            productLabel.Width = 310;
            productLabel.Height = 38;
            productLabel.Font = new Font("Segoe UI", 11F, FontStyle.Bold);
            productLabel.ForeColor = Color.FromArgb(185, 160, 255);
            productLabel.Margin = new Padding(0, 24, 0, 4);
            content.Controls.Add(productLabel);

            titleLabel.AutoSize = false;
            titleLabel.Width = 310;
            titleLabel.Height = 100;
            titleLabel.Font = new Font("Segoe UI", 25F, FontStyle.Bold);
            titleLabel.ForeColor = Color.White;
            content.Controls.Add(titleLabel);

            descriptionLabel.AutoSize = false;
            descriptionLabel.Width = 310;
            descriptionLabel.Height = 120;
            descriptionLabel.Font = new Font("Segoe UI", 10.5F, FontStyle.Regular);
            descriptionLabel.ForeColor = Color.FromArgb(190, 185, 205);
            content.Controls.Add(descriptionLabel);

            statusLabel.AutoSize = false;
            statusLabel.Width = 310;
            statusLabel.Height = 58;
            statusLabel.Padding = new Padding(12, 10, 12, 10);
            statusLabel.BackColor = Color.FromArgb(25, 18, 43);
            statusLabel.ForeColor = Color.FromArgb(221, 214, 255);
            statusLabel.Margin = new Padding(0, 12, 0, 10);
            content.Controls.Add(statusLabel);

            progress.Width = 310;
            progress.Height = 12;
            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 25;
            progress.Visible = false;
            content.Controls.Add(progress);

            installButton.Width = 310;
            installButton.Height = 48;
            installButton.Font = new Font("Segoe UI", 11F, FontStyle.Bold);
            installButton.Margin = new Padding(0, 18, 0, 8);
            StyleButton(installButton, Color.FromArgb(112, 68, 224), Color.White);
            installButton.Click += InstallClicked;
            content.Controls.Add(installButton);

            launchButton.Width = 310;
            launchButton.Height = 44;
            launchButton.Visible = false;
            launchButton.Margin = new Padding(0, 0, 0, 8);
            StyleButton(launchButton, Color.FromArgb(28, 135, 100), Color.White);
            launchButton.Click += delegate
            {
                try { InstallationRuntime.LaunchInstalledApplication(); Close(); }
                catch (Exception error) { ShowError(error); }
            };
            content.Controls.Add(launchButton);

            uninstallButton.Width = 310;
            uninstallButton.Height = 42;
            uninstallButton.Margin = new Padding(0, 0, 0, 8);
            StyleButton(uninstallButton, Color.FromArgb(64, 38, 72), Color.FromArgb(255, 175, 190));
            uninstallButton.Click += UninstallClicked;
            content.Controls.Add(uninstallButton);

            closeButton.Width = 310;
            closeButton.Height = 40;
            StyleButton(closeButton, Color.FromArgb(28, 24, 38), Color.FromArgb(210, 205, 220));
            closeButton.Click += delegate { if (!busy) Close(); };
            content.Controls.Add(closeButton);
        }

        private static void StyleButton(Button button, Color backColor, Color foreColor)
        {
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor = Color.FromArgb(95, 75, 135);
            button.BackColor = backColor;
            button.ForeColor = foreColor;
            button.Cursor = Cursors.Hand;
        }

        private void LoadSlides()
        {
            foreach (string resource in EmbeddedAssets.SlideResources)
            {
                using (Stream stream = EmbeddedAssets.Open(resource))
                using (Image original = Image.FromStream(stream))
                {
                    slides.Add(new Bitmap(original));
                }
            }
            ShowSlide(0);
        }

        private void ShowSlide(int index)
        {
            if (slides.Count == 0) return;
            slideIndex = (index + slides.Count) % slides.Count;
            slidePicture.Image = slides[slideIndex];
            slideCounter.Text = (slideIndex + 1).ToString("00") + " / " + slides.Count.ToString("00");
        }

        private void AdvanceSlide()
        {
            ShowSlide(slideIndex + 1);
        }

        private void DisposeSlides()
        {
            carouselTimer.Stop();
            slidePicture.Image = null;
            foreach (Image image in slides) image.Dispose();
            slides.Clear();
        }

        private void UpdateLanguage()
        {
            RightToLeft = arabic ? RightToLeft.Yes : RightToLeft.No;
            productLabel.Text = "A KNOUX PRODUCT";
            languageButton.Text = arabic ? "English" : "العربية";
            titleLabel.Text = arabic ? "ثبّت KNOUX Player X" : "Install KNOUX Player X";
            descriptionLabel.Text = arabic
                ? "مشغل وسائط احترافي ومجموعة إبداعية محلية. يعرض هذا المثبت الصور الرسمية التسع أثناء التثبيت، ويدعم التثبيت والترقية والإصلاح والإزالة."
                : "A professional offline media player and creative suite. This installer displays all nine official product slides and supports install, upgrade, repair and uninstall.";
            launchButton.Text = arabic ? "تشغيل KNOUX Player X" : "Launch KNOUX Player X";
            uninstallButton.Text = arabic ? "إزالة التطبيق" : "Uninstall";
            closeButton.Text = arabic ? "إغلاق" : "Close";
            UpdateInstallState();
        }

        private void UpdateInstallState()
        {
            bool installed = !String.IsNullOrEmpty(InstallationRuntime.FindInstalledApplication());
            installButton.Text = installed
                ? (arabic ? "ترقية أو إصلاح" : "Upgrade or Repair")
                : (arabic ? "تثبيت الآن" : "Install now");
            uninstallButton.Enabled = installed && !busy;
            statusLabel.Text = installed
                ? (arabic ? "تم اكتشاف نسخة مثبتة. يمكنك ترقيتها أو إصلاحها أو إزالتها." : "An installed copy was detected. You can upgrade, repair or uninstall it.")
                : (arabic ? "جاهز للتثبيت المحلي الآمن لكل مستخدم." : "Ready for a secure per-user local installation.");
        }

        private void SetBusy(bool value, string status)
        {
            busy = value;
            progress.Visible = value;
            installButton.Enabled = !value;
            uninstallButton.Enabled = !value && !String.IsNullOrEmpty(InstallationRuntime.FindInstalledApplication());
            closeButton.Enabled = !value;
            languageButton.Enabled = !value;
            statusLabel.Text = status;
        }

        private async void InstallClicked(object sender, EventArgs eventArgs)
        {
            SetBusy(true, arabic ? "جارٍ التثبيت والتحقق من الملفات…" : "Installing and verifying files…");
            try
            {
                int exitCode = await Task.Run(delegate { return InstallationRuntime.InstallOrRepair(); });
                if (exitCode != 0) throw new InvalidOperationException("Installer returned exit code " + exitCode + ".");
                statusLabel.Text = arabic ? "اكتمل التثبيت بنجاح." : "Installation completed successfully.";
                launchButton.Visible = true;
            }
            catch (Exception error)
            {
                ShowError(error);
            }
            finally
            {
                busy = false;
                progress.Visible = false;
                closeButton.Enabled = true;
                languageButton.Enabled = true;
                UpdateInstallState();
            }
        }

        private async void UninstallClicked(object sender, EventArgs eventArgs)
        {
            DialogResult confirmation = MessageBox.Show(
                arabic ? "هل تريد إزالة KNOUX Player X؟" : "Uninstall KNOUX Player X?",
                "KNOUX Player X",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (confirmation != DialogResult.Yes) return;
            SetBusy(true, arabic ? "جارٍ إزالة التطبيق…" : "Uninstalling…");
            try
            {
                int exitCode = await Task.Run(delegate { return InstallationRuntime.Uninstall(); });
                if (exitCode != 0 || !InstallationRuntime.WaitForInstallation(false, 180000))
                {
                    throw new InvalidOperationException("Uninstaller returned exit code " + exitCode + ".");
                }
                statusLabel.Text = arabic ? "تمت إزالة التطبيق." : "The application was uninstalled.";
                launchButton.Visible = false;
            }
            catch (Exception error)
            {
                ShowError(error);
            }
            finally
            {
                busy = false;
                progress.Visible = false;
                closeButton.Enabled = true;
                languageButton.Enabled = true;
                UpdateInstallState();
            }
        }

        private void ShowError(Exception error)
        {
            statusLabel.Text = arabic ? "فشلت العملية. راجع رسالة الخطأ." : "The operation failed. Review the error message.";
            MessageBox.Show(error.Message, "KNOUX Player X", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            string evidencePath = EvidenceMode.ArgumentValue(args, "--evidence=");
            if (args.Any(delegate(string value) { return value.Equals("--self-test", StringComparison.OrdinalIgnoreCase); }))
            {
                return EvidenceMode.SelfTest(evidencePath);
            }
            if (args.Any(delegate(string value) { return value.Equals("--install-silent-test", StringComparison.OrdinalIgnoreCase); }))
            {
                return EvidenceMode.InstallationTest("install", evidencePath);
            }
            if (args.Any(delegate(string value) { return value.Equals("--repair-silent-test", StringComparison.OrdinalIgnoreCase); }))
            {
                return EvidenceMode.InstallationTest("repair", evidencePath);
            }
            if (args.Any(delegate(string value) { return value.Equals("--uninstall-silent-test", StringComparison.OrdinalIgnoreCase); }))
            {
                return EvidenceMode.InstallationTest("uninstall", evidencePath);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
            return 0;
        }
    }
}
