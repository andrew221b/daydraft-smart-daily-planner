import WidgetKit
import SwiftUI

@main
struct DayDraftWidgetsBundle: WidgetBundle {
    var body: some Widget {
        FocusLiveActivityWidget()
        TrackerLiveActivityWidget()
    }
}
