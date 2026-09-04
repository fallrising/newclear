package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ClientSignalHasherTest {

    private static final byte[] SECRET = new byte[32];
    private ClientSignalHasher hasher;

    @BeforeEach
    void setUp() {
        hasher = new ClientSignalHasher(SECRET);
    }

    @Test
    void strictIpv4UsesNetworkBytesAndMappedIpv6NormalizesToTheSamePartition()
            throws Exception {
        String expected = hmac(concat(
                "phark-ip-v1:".getBytes(StandardCharsets.UTF_8),
                new byte[] {4, (byte) 192, 0, 2, 44}));

        assertThat(hasher.hashIp("192.0.2.44")).isEqualTo(expected);
        assertThat(hasher.hashIp("::ffff:192.0.2.44")).isEqualTo(expected);
        assertThat(hasher.hashIp("::ffff:c000:022c")).isEqualTo(expected);
        assertThat(hasher.hashIp("192.0.2.45")).isNotEqualTo(expected);
    }

    @Test
    void nativeIpv6UsesOnlyTheUpperSixtyFourBitNetworkPartition() {
        String compressed = hasher.hashIp("2001:db8:1234:5678::1");

        assertThat(hasher.hashIp("2001:0db8:1234:5678:ffff:eeee:dddd:cccc"))
                .isEqualTo(compressed);
        assertThat(hasher.hashIp("2001:db8:1234:5679::1")).isNotEqualTo(compressed);
    }

    @Test
    void invalidAndNonLiteralAddressesShareOneFailClosedUnknownPartition() {
        String unknown = hasher.hashIp(null);

        assertThat(hasher.hashIp("")).isEqualTo(unknown);
        assertThat(hasher.hashIp(" 192.0.2.44")).isEqualTo(unknown);
        assertThat(hasher.hashIp("192.0.2.44 ")).isEqualTo(unknown);
        assertThat(hasher.hashIp("192.0.2.044")).isEqualTo(unknown);
        assertThat(hasher.hashIp("127.1")).isEqualTo(unknown);
        assertThat(hasher.hashIp("256.0.0.1")).isEqualTo(unknown);
        assertThat(hasher.hashIp("2001:db8::1%eth0")).isEqualTo(unknown);
        assertThat(hasher.hashIp("localhost")).isEqualTo(unknown);
        assertThat(hasher.hashIp("example.invalid")).isEqualTo(unknown);
        assertThat(hasher.hashIp("::ffff:192.0.2.044")).isEqualTo(unknown);
        assertThat(hasher.hashIp("::192.0.2.44")).isEqualTo(unknown);
        assertThat(hasher.hashIp("192.0.2.44")).isNotEqualTo(unknown);
    }

    @Test
    void accountKeysUseTheExactSeparateDomainAndRequirePositiveIds() throws Exception {
        String expected = hmac("phark-account-v1:42".getBytes(StandardCharsets.UTF_8));

        assertThat(hasher.hashAccount(42)).isEqualTo(expected);
        assertThat(hasher.hashAccount(42)).isNotEqualTo(hasher.hashIp("0.0.0.42"));
        assertThatThrownBy(() -> hasher.hashAccount(0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> hasher.hashAccount(-1))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void outputsAreDeterministicLowercaseHexWithoutRawInput() {
        String address = "203.0.113.77";
        String first = hasher.hashIp(address);

        assertThat(first).matches("[0-9a-f]{64}");
        assertThat(hasher.hashIp(address)).isEqualTo(first);
        assertThat(first).doesNotContain(address);
    }

    @Test
    void constructorDefensivelyCopiesTheSecret() {
        byte[] mutableSecret = new byte[32];
        ClientSignalHasher isolated = new ClientSignalHasher(mutableSecret);
        String beforeMutation = isolated.hashIp("192.0.2.44");

        java.util.Arrays.fill(mutableSecret, (byte) 7);

        assertThat(isolated.hashIp("192.0.2.44")).isEqualTo(beforeMutation);
    }

    private static String hmac(byte[] input) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET, "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(input));
    }

    private static byte[] concat(byte[] first, byte[] second) {
        byte[] joined = new byte[first.length + second.length];
        System.arraycopy(first, 0, joined, 0, first.length);
        System.arraycopy(second, 0, joined, first.length, second.length);
        return joined;
    }
}
