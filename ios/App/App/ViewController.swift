import UIKit
import Capacitor

/// Root view controller for the Capacitor web view.
///
/// App-local plugins (those not shipped as SPM packages) are NOT
/// auto-discovered by the Capacitor bridge — they must be registered
/// here via `bridge?.registerPluginInstance(_:)`.
class ViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(SpeechRecognitionPlugin())
    }
}
