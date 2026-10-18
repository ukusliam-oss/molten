// snap.swift <url> <out.png> [width] [height] [delay]
// Renders a page in a private (non-persistent) WebKit session, offscreen, and saves a PNG.
import AppKit
import WebKit

let args = CommandLine.arguments
let url = URL(string: args[1])!
let out = URL(fileURLWithPath: args[2])
let w = args.count > 3 ? Double(args[3])! : 390
let h = args.count > 4 ? Double(args[4])! : 844
let delay = args.count > 5 ? Double(args[5])! : 4

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

final class Snapper: NSObject, WKNavigationDelegate {
  let web: WKWebView
  let window: NSWindow
  init(w: Double, h: Double) {
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .nonPersistent()
    if args.count > 6, let js = try? String(contentsOfFile: args[6], encoding: .utf8) {
      cfg.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: cfg)
    web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: w, height: h), styleMask: .borderless, backing: .buffered, defer: false)
    window.contentView = web
    window.orderFrontRegardless()
    super.init()
    web.navigationDelegate = self
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
      webView.takeSnapshot(with: nil) { image, error in
        guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
          FileHandle.standardError.write("snapshot failed: \(String(describing: error))\n".data(using: .utf8)!); exit(1)
        }
        try! png.write(to: out)
        print("saved \(out.path) \(Int(rep.pixelsWide))x\(Int(rep.pixelsHigh))")
        exit(0)
      }
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { print("fail \(error)"); exit(1) }
}

let snapper = Snapper(w: w, h: h)
snapper.web.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + 40) { print("timeout"); exit(2) }
app.run()
