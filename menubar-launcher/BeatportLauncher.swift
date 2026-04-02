import AppKit
import Foundation

// MARK: - Launcher Controller

final class BeatportLauncherController: NSObject, NSMenuDelegate {

    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let suiteRoot = URL(fileURLWithPath: NSString("~/Projects/_local/beatport-dj-suite").expandingTildeInPath)
    private var electronProcess: Process?

    func start() {
        NSApp.setActivationPolicy(.accessory)
        if let button = statusItem.button {
            button.title = "🎵"
            button.toolTip = "Beatport DJ Suite"
        }
        menu.delegate = self
        statusItem.menu = menu
        buildMenu()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        buildMenu()
    }

    // MARK: - Menu

    private func buildMenu() {
        menu.removeAllItems()

        let isRunning = electronProcess?.isRunning == true

        // Status
        let statusTitle = isRunning ? "🟢  Beatport DJ Suite läuft" : "⚫  Beatport DJ Suite gestoppt"
        menu.addItem(disabledItem(statusTitle))
        menu.addItem(NSMenuItem.separator())

        // Start / Stop
        if isRunning {
            menu.addItem(makeItem("⏹  Suite beenden", #selector(stopSuite)))
        } else {
            let startItem = makeItem("▶  Suite starten", #selector(startSuite))
            startItem.keyEquivalent = "b"
            startItem.keyEquivalentModifierMask = [.command, .shift]
            menu.addItem(startItem)
        }

        menu.addItem(NSMenuItem.separator())

        // Quick-Links
        menu.addItem(makeItem("📁  Projektordner öffnen", #selector(openFolder)))
        menu.addItem(makeItem("🖥  Terminal öffnen", #selector(openTerminal)))

        menu.addItem(NSMenuItem.separator())
        menu.addItem(makeItem("Beenden", #selector(quitApp)))
    }

    // MARK: - Actions

    @objc private func startSuite() {
        guard electronProcess?.isRunning != true else { return }

        let npmPaths = ["/opt/homebrew/bin/npm", "/usr/local/bin/npm"]
        guard let npm = npmPaths.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            alert("npm nicht gefunden", "Erwartet unter /opt/homebrew/bin/npm oder /usr/local/bin/npm.")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: npm)
        process.arguments = ["run", "desktop:dev"]
        process.currentDirectoryURL = suiteRoot
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.electronProcess = nil
                self?.updateStatusIcon(running: false)
                self?.buildMenu()
            }
        }

        do {
            try process.run()
            electronProcess = process
            updateStatusIcon(running: true)
            buildMenu()
        } catch {
            alert("Starten fehlgeschlagen", error.localizedDescription)
        }
    }

    @objc private func stopSuite() {
        electronProcess?.terminate()
        electronProcess = nil
        updateStatusIcon(running: false)
        buildMenu()
    }

    @objc private func openFolder() {
        NSWorkspace.shared.open(suiteRoot)
    }

    @objc private func openTerminal() {
        let script = """
        tell application "Terminal"
            do script "cd '\(suiteRoot.path)'"
            activate
        end tell
        """
        var error: NSDictionary?
        NSAppleScript(source: script)?.executeAndReturnError(&error)
    }

    @objc private func quitApp() {
        electronProcess?.terminate()
        NSApp.terminate(nil)
    }

    // MARK: - Helpers

    private func updateStatusIcon(running: Bool) {
        DispatchQueue.main.async {
            self.statusItem.button?.title = running ? "🎵●" : "🎵"
        }
    }

    private func makeItem(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    private func disabledItem(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    private func alert(_ title: String, _ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = title
        a.informativeText = message
        a.addButton(withTitle: "OK")
        a.runModal()
    }
}

// MARK: - Entry Point

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let controller = BeatportLauncherController()
    func applicationDidFinishLaunching(_ n: Notification) { controller.start() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
