package com.fallrising.cms;

import com.fallrising.cms.identity.IdentityProperties;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class IdentitySeedPasswordTests {

    @Test
    void commonSeedPasswordRemainsExplicitAndIndependentOfAdminSpecificPassword() {
        IdentityProperties props = new IdentityProperties();
        props.setSeedPassword("CommonDevelopmentSeedPassword");

        assertThat(props.seedPasswordFor("seed-editor-album")).isEqualTo("CommonDevelopmentSeedPassword");
        assertThat(props.seedPasswordFor("seed-admin")).isEqualTo("CommonDevelopmentSeedPassword");
    }

    @Test
    void noCommonPasswordProducesNoSharedFallback() {
        IdentityProperties props = new IdentityProperties();
        props.setSeedPassword("");

        assertThat(props.seedPasswordFor("seed-editor-album")).isNull();
        assertThat(props.seedPasswordFor("seed-operator-album")).isNull();
    }
}
