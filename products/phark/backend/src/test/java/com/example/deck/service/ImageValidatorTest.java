package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.ValidatedImage;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class ImageValidatorTest {

    private static final int MAX_BYTES = 5 * 1024 * 1024;

    private final ImageValidator validator = new ImageValidator();

    @Test
    void validJpegReturnsCanonicalMetadata() throws Exception {
        byte[] bytes = jpeg(1200, 800);

        ValidatedImage validated = validator.validate("image/jpeg", stream(bytes));

        assertThat(validated.contentType()).isEqualTo("image/jpeg");
        assertThat(validated.extension()).isEqualTo("jpg");
        assertThat(validated.byteSize()).isEqualTo(bytes.length);
        assertThat(validated.width()).isEqualTo(1200);
        assertThat(validated.height()).isEqualTo(800);
        assertThat(validated.sha256())
                .matches("[0-9a-f]{64}")
                .isEqualTo(sha256Hex(bytes));
    }

    @Test
    void validPngReturnsCanonicalMetadata() throws Exception {
        byte[] bytes = png(640, 480);

        ValidatedImage validated = validator.validate("image/png", stream(bytes));

        assertThat(validated.contentType()).isEqualTo("image/png");
        assertThat(validated.extension()).isEqualTo("png");
        assertThat(validated.byteSize()).isEqualTo(bytes.length);
        assertThat(validated.width()).isEqualTo(640);
        assertThat(validated.height()).isEqualTo(480);
        assertThat(validated.sha256())
                .matches("[0-9a-f]{64}")
                .isEqualTo(sha256Hex(bytes));
    }

    @Test
    void declaredMimeIsCanonicalizedWhenCaseDiffers() throws Exception {
        ValidatedImage validated =
                validator.validate("Image/JPEG", stream(jpeg(20, 20)));

        assertThat(validated.contentType()).isEqualTo("image/jpeg");
        assertThat(validated.extension()).isEqualTo("jpg");
    }

    @Test
    void validatedBytesAreTheOriginalUnmodifiedInput() throws Exception {
        byte[] bytes = jpeg(240, 160);

        ValidatedImage validated = validator.validate("image/jpeg", stream(bytes));

        assertThat(validated.bytes()).isEqualTo(bytes);
        assertThat(validated.byteSize()).isEqualTo(bytes.length);
    }

    @Test
    void mutatingReturnedBytesArrayDoesNotCorruptValidatedImage() throws Exception {
        byte[] bytes = jpeg(240, 160);

        ValidatedImage validated = validator.validate("image/jpeg", stream(bytes));

        validated.bytes()[0] = 0;

        assertThat(validated.bytes()).isEqualTo(bytes);
        assertThat(validated.sha256()).isEqualTo(sha256Hex(bytes));
    }

    @Test
    void mutatingSourceBytesAfterValidationDoesNotCorruptValidatedImage() throws Exception {
        byte[] bytes = jpeg(240, 160);
        byte[] original = bytes.clone();

        ValidatedImage validated = validator.validate("image/jpeg", stream(bytes));
        bytes[0] = 0;

        assertThat(validated.bytes()).isEqualTo(original);
        assertThat(validated.byteSize()).isEqualTo(original.length);
        assertThat(validated.sha256()).isEqualTo(sha256Hex(original));
    }

    @Test
    void constructorDefensivelyCopiesInputByteArray() {
        byte[] mutable = {1, 2, 3};
        ValidatedImage image =
                new ValidatedImage(mutable, "image/jpeg", "jpg", mutable.length, 1, 1, "a".repeat(64));

        mutable[0] = 9;

        assertThat(image.bytes()).isEqualTo(new byte[] {1, 2, 3});
    }

    @Test
    void inputStreamReadFailureBecomesFixedMessageInvalidImageException() {
        java.io.InputStream failing = new java.io.InputStream() {
            @Override
            public int read() throws java.io.IOException {
                throw new java.io.IOException("simulated read failure");
            }
        };

        assertThatThrownBy(() -> validator.validate("image/jpeg", failing))
                .isInstanceOf(InvalidImageException.class)
                .isNotInstanceOf(ImageTooLargeException.class)
                .hasMessage(InvalidImageException.DEFAULT_MESSAGE)
                .satisfies(exception -> assertThat(exception.getMessage())
                        .doesNotContain("simulated", "IOException"));
    }

    @Test
    void dimensionsAtAllowedBoundariesAreAccepted() throws Exception {
        ValidatedImage wide = validator.validate("image/jpeg", stream(jpeg(4096, 1)));
        ValidatedImage tall = validator.validate("image/jpeg", stream(jpeg(1, 4096)));
        ValidatedImage exactPixelCeiling = validator.validate("image/png", stream(png(4000, 3000)));

        assertThat(wide.width()).isEqualTo(4096);
        assertThat(wide.height()).isEqualTo(1);
        assertThat(tall.width()).isEqualTo(1);
        assertThat(tall.height()).isEqualTo(4096);
        assertThat(exactPixelCeiling.width()).isEqualTo(4000);
        assertThat(exactPixelCeiling.height()).isEqualTo(3000);
        assertThat((long) wide.width() * wide.height()).isEqualTo(4096L);
        assertThat((long) exactPixelCeiling.width() * exactPixelCeiling.height())
                .isEqualTo(12_000_000L);
    }

    @Test
    void widthAboveAllowedMaximumIsRejected() throws Exception {
        assertInvalid(() -> validator.validate("image/jpeg", stream(jpeg(4097, 1))));
    }

    @Test
    void heightAboveAllowedMaximumIsRejected() throws Exception {
        assertInvalid(() -> validator.validate("image/jpeg", stream(jpeg(1, 4097))));
    }

    @Test
    void pixelCountAboveAllowedMaximumIsRejected() throws Exception {
        assertInvalid(() -> validator.validate("image/png", stream(png(4000, 3001))));
    }

    @Test
    void emptyInputIsRejected() throws Exception {
        assertInvalid(() -> validator.validate("image/jpeg", stream(new byte[0])));
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {
            "",
            "image/gif",
            "image/webp",
            "text/plain",
            "application/octet-stream",
            "image/jpg",
            "image/jpeg; charset=binary",
            "image/png; charset=binary"
    })
    void declaredContentTypeOutsideJpegPngIsRejected(String declared) throws Exception {
        assertInvalid(() -> validator.validate(declared, stream(jpeg(20, 20))));
    }

    @Test
    void declaredJpegWithPngContentIsRejected() throws Exception {
        assertInvalid(() -> validator.validate("image/jpeg", stream(png(20, 20))));
    }

    @Test
    void declaredPngWithJpegContentIsRejected() throws Exception {
        assertInvalid(() -> validator.validate("image/png", stream(jpeg(20, 20))));
    }

    @Test
    void truncatedJpegIsRejected() throws Exception {
        byte[] full = jpeg(1200, 800);
        byte[] truncated = java.util.Arrays.copyOf(full, 48);

        assertInvalid(() -> validator.validate("image/jpeg", stream(truncated)));
    }

    @Test
    void truncatedPngIsRejected() throws Exception {
        byte[] full = png(1200, 800);
        byte[] truncated = java.util.Arrays.copyOf(full, full.length / 2);

        assertInvalid(() -> validator.validate("image/png", stream(truncated)));
    }

    @Test
    void pngSignatureWithGarbageBodyIsRejected() throws Exception {
        byte[] garbage = new byte[64];
        byte[] pngSignature = {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
        byte[] input = new byte[pngSignature.length + garbage.length];
        System.arraycopy(pngSignature, 0, input, 0, pngSignature.length);

        assertInvalid(() -> validator.validate("image/png", stream(input)));
    }

    @Test
    void unsupportedMagicBytesAreRejected() throws Exception {
        byte[] gif = "GIF89a".getBytes(java.nio.charset.StandardCharsets.US_ASCII);

        assertInvalid(() -> validator.validate("image/jpeg", stream(gif)));
    }

    @Test
    void svgBytesAreRejected() throws Exception {
        byte[] svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);

        assertInvalid(() -> validator.validate("image/svg+xml", stream(svg)));
    }

    @Test
    void inputAboveFiveMiBIsRejectedAsTooLarge() throws Exception {
        assertThatThrownBy(() -> validator.validate("image/jpeg", stream(new byte[MAX_BYTES + 1])))
                .isInstanceOf(ImageTooLargeException.class);
    }

    @Test
    void inputAtExactlyFiveMiBIsNotTooLarge() throws Exception {
        assertThatThrownBy(() -> validator.validate("image/jpeg", stream(new byte[MAX_BYTES])))
                .isInstanceOf(InvalidImageException.class)
                .satisfies(exception -> assertThat(exception).isNotInstanceOf(ImageTooLargeException.class));
    }

    @Test
    void tooLargeExceptionMessageIsPublicSafe() {
        assertThatThrownBy(() -> validator.validate("image/jpeg", stream(new byte[MAX_BYTES + 1])))
                .isInstanceOf(ImageTooLargeException.class)
                .hasMessage("The uploaded image exceeds the maximum allowed size of 5 MiB.");
    }

    @Test
    void invalidExceptionMessageIsPublicSafe() {
        assertThatThrownBy(() -> validator.validate("image/jpeg", stream("GIF89a".getBytes())))
                .isInstanceOfSatisfying(InvalidImageException.class, exception -> {
                    String message = exception.getMessage();
                    assertThat(message)
                            .isEqualTo("The uploaded file is not a valid JPEG or PNG image.")
                            .doesNotContain("ImageIO", "IOException", "path", "/", "\\", "GIF89a");
                });
    }

    private static void assertInvalid(ThrowingValidator action) {
        assertThatThrownBy(action::run)
                .isInstanceOf(InvalidImageException.class)
                .isNotInstanceOf(ImageTooLargeException.class);
    }

    @FunctionalInterface
    private interface ThrowingValidator {
        void run() throws Exception;
    }

    private static ByteArrayInputStream stream(byte[] bytes) {
        return new ByteArrayInputStream(bytes);
    }

    private static byte[] jpeg(int width, int height) throws Exception {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_3BYTE_BGR);
        java.awt.Graphics2D graphics = image.createGraphics();
        graphics.setColor(java.awt.Color.WHITE);
        graphics.fillRect(0, 0, width, height);
        graphics.dispose();
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        if (!ImageIO.write(image, "jpg", out)) {
            throw new IllegalStateException("No JPEG writer available");
        }
        return out.toByteArray();
    }

    private static byte[] png(int width, int height) throws Exception {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D graphics = image.createGraphics();
        graphics.setColor(java.awt.Color.WHITE);
        graphics.fillRect(0, 0, width, height);
        graphics.dispose();
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        if (!ImageIO.write(image, "png", out)) {
            throw new IllegalStateException("No PNG writer available");
        }
        return out.toByteArray();
    }

    private static String sha256Hex(byte[] data) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
    }
}