import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2,
      let requestedPid = Int32(CommandLine.arguments[1])
else {
    FileHandle.standardError.write(Data("usage: macos-window-check <pid>\n".utf8))
    exit(2)
}

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID)
let windows = windowList as? [[String: Any]] ?? []

for window in windows {
    let ownerPid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
    let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue
    let alpha = (window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue
    let windowId = (window[kCGWindowNumber as String] as? NSNumber)?.intValue
    let boundsValue = window[kCGWindowBounds as String] as? NSDictionary

    guard ownerPid == requestedPid,
          layer == 0,
          (alpha ?? 0) > 0,
          let windowId,
          let boundsValue,
          let bounds = CGRect(
              dictionaryRepresentation: boundsValue as CFDictionary
          ),
          bounds.width > 0,
          bounds.height > 0
    else {
        continue
    }

    let result: [String: Any] = [
        "visible": true,
        "windowId": windowId,
        "width": Int(bounds.width),
        "height": Int(bounds.height),
    ]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

FileHandle.standardError.write(
    Data("no on-screen layer-zero window is owned by pid \(requestedPid)\n".utf8)
)
exit(1)
