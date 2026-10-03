package com.fallrising.cms.identity.service;

import java.util.List;

/** Enabled content type keys in key order. Implemented by the content module so identity does not depend on it. */
public interface ContentTypeDirectory {

    List<String> enabledTypeKeys();
}
