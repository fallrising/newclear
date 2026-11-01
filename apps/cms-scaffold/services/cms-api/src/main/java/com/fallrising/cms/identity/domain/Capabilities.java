package com.fallrising.cms.identity.domain;

import java.util.List;

/**
 * What the caller may do on one surface (02 BD-07). types lists only enabled types with at least one action;
 * scoped is true when some listed action is granted only through predicate grants (it applies to some entries).
 */
public record Capabilities(String surface, List<TypeCapability> types, List<String> global) {

    public record TypeCapability(String key, List<String> actions, boolean scoped) {}
}
