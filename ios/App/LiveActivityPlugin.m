//
//  LiveActivityPlugin.m
//  App
//
//  Registration is handled in Swift via CAPBridgedPlugin (see
//  LiveActivityPlugin.swift) — that's how Capacitor 8 discovers plugins.
//  The legacy CAP_PLUGIN macro is intentionally NOT used here; having both
//  would register the plugin twice with a stub class that wins over the real
//  Swift implementation, causing UNIMPLEMENTED errors on every call.
//

#import <Foundation/Foundation.h>
