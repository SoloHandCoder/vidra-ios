import Capacitor
import UIKit

/// The app's web view controller: registers the app's own native plugin.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(StreambertPlugin())
    }
}
