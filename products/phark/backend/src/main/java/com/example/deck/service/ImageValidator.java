package com.example.deck.service;

import com.example.deck.model.ValidatedImage;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.stereotype.Component;

@Component
public class ImageValidator {

    public static final int MAX_BYTES = 5 * 1024 * 1024;
    public static final int MIN_DIMENSION = 1;
    public static final int MAX_DIMENSION = 4096;
    public static final long MAX_PIXELS = 12_000_000L;

    private static final String JPEG_MIME = "image/jpeg";
    private static final String PNG_MIME = "image/png";
    private static final byte[] JPEG_MAGIC = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};
    private static final byte[] PNG_MAGIC = {
        (byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
    };

    public ValidatedImage validate(String declaredContentType, InputStream input) {
        Format declared = formatFor(declaredContentType);
        byte[] data = readBounded(input);
        Format detected = detectFormat(data);
        if (detected == null || detected != declared) {
            throw new InvalidImageException();
        }

        ImageDimensions dimensions = verifyAndDecode(declared, data);
        return new ValidatedImage(
                data,
                declared.contentType,
                declared.extension,
                data.length,
                dimensions.width(),
                dimensions.height(),
                sha256Hex(data));
    }

    private static Format formatFor(String declaredContentType) {
        if (declaredContentType == null) {
            throw new InvalidImageException();
        }
        String trimmed = declaredContentType.trim();
        if (trimmed.equalsIgnoreCase(JPEG_MIME)) {
            return Format.JPEG;
        }
        if (trimmed.equalsIgnoreCase(PNG_MIME)) {
            return Format.PNG;
        }
        throw new InvalidImageException();
    }

    private static byte[] readBounded(InputStream input) {
        if (input == null) {
            throw new InvalidImageException();
        }
        byte[] data;
        try {
            data = input.readNBytes(MAX_BYTES + 1);
        } catch (IOException exception) {
            throw new InvalidImageException();
        }
        if (data.length > MAX_BYTES) {
            throw new ImageTooLargeException();
        }
        return data;
    }

    private static Format detectFormat(byte[] data) {
        if (startsWith(data, JPEG_MAGIC)) {
            return Format.JPEG;
        }
        if (startsWith(data, PNG_MAGIC)) {
            return Format.PNG;
        }
        return null;
    }

    private static boolean startsWith(byte[] data, byte[] prefix) {
        if (data.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (data[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private static ImageDimensions verifyAndDecode(Format format, byte[] data) {
        try (ImageInputStream stream = new MemoryCacheImageInputStream(new ByteArrayInputStream(data))) {
            if (stream == null) {
                throw new InvalidImageException();
            }
            ImageReader reader = null;
            try {
                Iterator<ImageReader> readers = ImageIO.getImageReaders(stream);
                if (!readers.hasNext()) {
                    throw new InvalidImageException();
                }
                reader = readers.next();
                reader.setInput(stream, true, true);
                if (!format.formatName.equalsIgnoreCase(reader.getFormatName())) {
                    throw new InvalidImageException();
                }

                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width < MIN_DIMENSION
                        || width > MAX_DIMENSION
                        || height < MIN_DIMENSION
                        || height > MAX_DIMENSION) {
                    throw new InvalidImageException();
                }
                long pixels = (long) width * height;
                if (pixels > MAX_PIXELS) {
                    throw new InvalidImageException();
                }

                BufferedImage decoded = reader.read(0);
                if (decoded == null) {
                    throw new InvalidImageException();
                }
                return new ImageDimensions(width, height);
            } catch (IOException exception) {
                throw new InvalidImageException();
            } finally {
                if (reader != null) {
                    reader.dispose();
                }
            }
        } catch (IOException exception) {
            throw new InvalidImageException();
        }
    }

    private static String sha256Hex(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private record ImageDimensions(int width, int height) {}

    private enum Format {
        JPEG(JPEG_MIME, "jpg", "jpeg"),
        PNG(PNG_MIME, "png", "png");

        private final String contentType;
        private final String extension;
        private final String formatName;

        Format(String contentType, String extension, String formatName) {
            this.contentType = contentType;
            this.extension = extension;
            this.formatName = formatName;
        }
    }
}