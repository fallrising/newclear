package com.example.deck.service;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class ClientSignalHasher {

    private static final byte[] IP_DOMAIN = "phark-ip-v1:".getBytes(StandardCharsets.UTF_8);
    private static final String ACCOUNT_DOMAIN = "phark-account-v1:";
    private static final Pattern IPV4_OCTET = Pattern.compile("0|[1-9][0-9]{0,2}");
    private static final Pattern NUMERIC_IPV6 = Pattern.compile("[0-9A-Fa-f:.]+");

    private final SecretKeySpec secretKey;

    public ClientSignalHasher(byte[] secret) {
        if (secret == null || secret.length != 32) {
            throw new IllegalArgumentException("HMAC secret must contain exactly 32 bytes");
        }
        this.secretKey = new SecretKeySpec(secret.clone(), "HmacSHA256");
    }

    public String hashIp(String remoteAddress) {
        IpPartition partition = parseIp(remoteAddress);
        byte[] input = new byte[IP_DOMAIN.length + 1 + partition.networkBytes().length];
        System.arraycopy(IP_DOMAIN, 0, input, 0, IP_DOMAIN.length);
        input[IP_DOMAIN.length] = partition.family();
        System.arraycopy(
                partition.networkBytes(),
                0,
                input,
                IP_DOMAIN.length + 1,
                partition.networkBytes().length);
        return hmac(input);
    }

    public String hashAccount(long accountId) {
        if (accountId <= 0) {
            throw new IllegalArgumentException("Account id must be positive");
        }
        return hmac((ACCOUNT_DOMAIN + accountId).getBytes(StandardCharsets.UTF_8));
    }

    private IpPartition parseIp(String remoteAddress) {
        if (remoteAddress == null
                || remoteAddress.isEmpty()
                || !remoteAddress.equals(remoteAddress.trim())) {
            return IpPartition.UNKNOWN;
        }

        if (!remoteAddress.contains(":")) {
            byte[] ipv4 = parseIpv4(remoteAddress);
            return ipv4 == null ? IpPartition.UNKNOWN : new IpPartition((byte) 4, ipv4);
        }

        if (!NUMERIC_IPV6.matcher(remoteAddress).matches()) {
            return IpPartition.UNKNOWN;
        }
        if (remoteAddress.contains(".")) {
            int suffixStart = remoteAddress.lastIndexOf(':') + 1;
            if (suffixStart <= 0 || parseIpv4(remoteAddress.substring(suffixStart)) == null) {
                return IpPartition.UNKNOWN;
            }
        }

        try {
            byte[] address = InetAddress.getByName(remoteAddress).getAddress();
            if (address.length == 4) {
                return new IpPartition((byte) 4, address);
            }
            if (address.length != 16 || remoteAddress.contains(".")) {
                return IpPartition.UNKNOWN;
            }
            if (isIpv4Mapped(address)) {
                return new IpPartition((byte) 4, Arrays.copyOfRange(address, 12, 16));
            }
            return new IpPartition((byte) 6, Arrays.copyOf(address, 8));
        } catch (UnknownHostException exception) {
            return IpPartition.UNKNOWN;
        }
    }

    private byte[] parseIpv4(String value) {
        String[] octets = value.split("\\.", -1);
        if (octets.length != 4) {
            return null;
        }

        byte[] bytes = new byte[4];
        for (int index = 0; index < octets.length; index++) {
            String octet = octets[index];
            if (!IPV4_OCTET.matcher(octet).matches()) {
                return null;
            }
            int parsed = Integer.parseInt(octet);
            if (parsed > 255) {
                return null;
            }
            bytes[index] = (byte) parsed;
        }
        return bytes;
    }

    private boolean isIpv4Mapped(byte[] address) {
        for (int index = 0; index < 10; index++) {
            if (address[index] != 0) {
                return false;
            }
        }
        return address[10] == (byte) 0xff && address[11] == (byte) 0xff;
    }

    private String hmac(byte[] input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(secretKey);
            return HexFormat.of().formatHex(mac.doFinal(input));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("HmacSHA256 is unavailable", exception);
        }
    }

    private record IpPartition(byte family, byte[] networkBytes) {
        private static final IpPartition UNKNOWN = new IpPartition((byte) 0, new byte[0]);
    }
}
