package com.fallrising.cms.ops;

import com.fallrising.cms.media.ImageVariants;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.*;

import static com.fallrising.cms.ops.RecoveryInventory.*;
import static org.junit.jupiter.api.Assertions.*;

class RecoveryInventoryTests {
    @TempDir Path root;
    final UUID id = UUID.fromString("10000000-0000-0000-0000-000000000001");
    final byte[] pdf = "%PDF-1.4\nfixture\n".getBytes(java.nio.charset.StandardCharsets.UTF_8);

    @Test void PP1c_unsafePathRejectedWithoutChangingSource() throws Exception {
        Path bad = Files.write(root.resolve("bad\\key"), pdf);
        failure("UNSAFE_MEDIA_PATH", () -> scanFiles(root, () -> {}));
        assertArrayEquals(pdf, Files.readAllBytes(bad));
    }
    @Test void PP1c_symlinkRejectedWithoutFollowing() throws Exception {
        Files.write(root.resolve("original"), pdf);
        Files.createSymbolicLink(root.resolve("link"), Path.of("original"));
        failure("UNSAFE_MEDIA_PATH", () -> scanFiles(root, () -> {}));
        assertTrue(Files.isSymbolicLink(root.resolve("link")));
    }
    @Test void PP1c_hardlinkRejected() throws Exception {
        Files.write(root.resolve("original"), pdf);
        Files.createLink(root.resolve("hard"), root.resolve("original"));
        failure("UNSAFE_MEDIA_PATH", () -> scanFiles(root, () -> {}));
    }
    @Test void PP1c_sourceChangedDuringInventoryRejected() throws Exception {
        Path file = Files.write(root.resolve("original"), pdf);
        failure("WRITER_NOT_QUIESCED", () -> scanFiles(root, () -> {
            try { Files.writeString(file, "changed"); }
            catch (java.io.IOException e) { throw new java.io.UncheckedIOException(e); }
        }));
        assertEquals("changed", Files.readString(file));
    }
    @Test void PP1c_missingOriginalRejected() throws Exception {
        failure("MISSING_MEDIA_OBJECT", () -> mediaFiles(root, List.of(asset(pdf, "application/pdf", null, null)),
                List.of(variant("original", pdf, "application/pdf", null, null))));
    }
    @Test void PP1c_checksumMismatchRejected() throws Exception {
        Files.write(root.resolve("original"), new byte[pdf.length]);
        failure("MEDIA_HASH_MISMATCH", () -> mediaFiles(root,
                List.of(asset(pdf, "application/pdf", null, null)),
                List.of(variant("original", pdf, "application/pdf", null, null))));
    }
    @Test void PP1c_decodedImageNeedsAllVariants() throws Exception {
        byte[] png = png();
        Files.write(root.resolve("original"), png);
        failure("IMAGE_VARIANTS_INCOMPLETE", () -> mediaFiles(root,
                List.of(asset(png, "image/png", 24, 12)),
                List.of(variant("original", png, "image/png", 24, 12))));
    }
    @Test void PP1c_extraRelationRejected() {
        failure("SCHEMA_UNSUPPORTED", () -> validateRelations(Set.of("intruder")));
    }
    @Test void PP1c_pdfDeletedAndOrphanRemainUnchanged() throws Exception {
        Files.write(root.resolve("original"), pdf);
        Files.writeString(root.resolve("orphan"), "orphan");
        AssetRow a = asset(pdf, "application/pdf", null, null);
        a = new AssetRow(a.id(), a.contentType(), a.byteSize(), a.storedBytes(), a.checksumSha256(), null, null, "deleted");
        List<FileRow> files = mediaFiles(root, List.of(a), List.of(variant("original", pdf, "application/pdf", null, null)));
        assertEquals(List.of("original", "orphan"), files.stream().map(FileRow::objectKey).toList());
        assertEquals(List.of("referenced", "orphan"), files.stream().map(FileRow::classification).toList());
        assertArrayEquals(pdf, Files.readAllBytes(root.resolve("original")));
        assertEquals("orphan", Files.readString(root.resolve("orphan")));
    }
    @Test void PP1c_decodeNullImageHasOnlyOriginal() throws Exception {
        Files.write(root.resolve("original"), pdf);
        List<FileRow> files = mediaFiles(root, List.of(asset(pdf, "image/webp", null, null)),
                List.of(variant("original", pdf, "image/webp", null, null)));
        assertEquals(1, files.size());
        assertNull(ImageVariants.read(pdf));
    }

    @Test void PP1c_canonicalUnicodeAndNullableDefensiveCopies() throws Exception {
        Map<String, String> row = new LinkedHashMap<>();
        row.put("z", null);
        row.put("a", "line\n\"\\");
        assertEquals("{\"a\":\"line\\n\\\"\\\\\",\"z\":null}\n",
                new String(canonicalBytes(row), java.nio.charset.StandardCharsets.UTF_8));
        Map<String, String> unicode = Map.of("\uD800\uDC00", "astral", "\uE000", "bmp");
        assertTrue(new String(canonicalBytes(unicode), java.nio.charset.StandardCharsets.UTF_8).startsWith("{\"\uE000\""));
        TableSchema schema = new TableSchema(List.of(), List.of(), List.of());
        TableSnapshot snapshot = new TableSnapshot("fixture", schema, List.of(row), "", "", "1", "");
        row.put("z", "mutated");
        assertNull(snapshot.rows().getFirst().get("z"));
        assertThrows(UnsupportedOperationException.class, () -> snapshot.rows().clear());
        assertThrows(UnsupportedOperationException.class, () -> snapshot.rows().getFirst().clear());
        assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonicalBytes(schema))),
                sha256(canonicalBytes(schema)));
    }

    @Test void PP1c_rootSymlinkAndNestedDirectoryLinkRejected() throws Exception {
        Path real = Files.createDirectory(root.resolve("real"));
        Path link = Files.createSymbolicLink(root.resolve("link"), real);
        failure("UNSAFE_MEDIA_PATH", () -> scanFiles(link, () -> {}));
        failure("UNSAFE_MEDIA_PATH", () -> scanFiles(root, () -> {}));
        assertTrue(Files.isSymbolicLink(link));
    }
    @Test void PP1c_sameBytesReplacementDetectedByFileIdentity() throws Exception {
        Path original = Files.write(root.resolve("original"), pdf);
        failure("WRITER_NOT_QUIESCED", () -> scanFiles(root, () -> {
            try {
                Path replacement = Files.write(root.resolve("replacement"), pdf);
                Files.move(replacement, original, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            } catch (java.io.IOException e) { throw new java.io.UncheckedIOException(e); }
        }));
        assertArrayEquals(pdf, Files.readAllBytes(original));
    }
    @Test void PP1c_directoryMembershipDriftRejected() throws Exception {
        Files.write(root.resolve("original"), pdf);
        failure("WRITER_NOT_QUIESCED", () -> scanFiles(root, () -> {
            try { Files.write(root.resolve("new-object"), pdf); }
            catch (java.io.IOException e) { throw new java.io.UncheckedIOException(e); }
        }));
        assertTrue(Files.exists(root.resolve("new-object")));
    }
    @Test void PP1c_stableFilesSortedAndHashedWithoutMutation() throws Exception {
        Files.createDirectory(root.resolve("nested"));
        Files.write(root.resolve("nested/z"), pdf);
        Files.write(root.resolve("a"), new byte[0]);
        List<FileRow> files = scanFiles(root, () -> {});
        assertEquals(List.of("a", "nested/z"), files.stream().map(FileRow::objectKey).toList());
        assertEquals("0", files.getFirst().byteSize());
        assertEquals(sha256(new byte[0]), files.getFirst().sha256());
        assertEquals(sha256(pdf), files.getLast().sha256());
        assertArrayEquals(pdf, Files.readAllBytes(root.resolve("nested/z")));
    }

    @Test void PP1c_unrelatedAncestorMembershipDoesNotChangeMedia() throws Exception {
        Path media = Files.createDirectory(root.resolve("media"));
        Files.write(media.resolve("original"), pdf);
        assertEquals(1, scanFiles(media, () -> {
            try { Files.write(root.resolve("unrelated"), pdf); }
            catch (java.io.IOException e) { throw new java.io.UncheckedIOException(e); }
        }).size());
    }

    AssetRow asset(byte[] bytes, String type, Integer width, Integer height) throws Exception {
        return new AssetRow(id, type, "" + bytes.length, "" + bytes.length,
                HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)), width, height, "available");
    }
    VariantRow variant(String name, byte[] bytes, String type, Integer width, Integer height) {
        return new VariantRow(id, name, type, "" + bytes.length, width, height, name);
    }
    static byte[] png() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(24, 12, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }
    static void failure(String code, org.junit.jupiter.api.function.Executable action) {
        assertEquals(code, assertThrows(Failure.class, action).code());
    }
}
