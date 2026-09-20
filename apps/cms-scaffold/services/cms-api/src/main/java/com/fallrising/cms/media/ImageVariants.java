package com.fallrising.cms.media;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

public final class ImageVariants {

    public record Raster(byte[] jpeg, int width, int height) {}

    private ImageVariants() {}

    public static BufferedImage read(byte[] bytes) {
        try {
            return ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (IOException e) {
            return null;
        }
    }

    public static Raster fit(BufferedImage source, int maxEdge, float quality) {
        int width = source.getWidth();
        int height = source.getHeight();
        double scale = Math.min(1.0, maxEdge / (double) Math.max(width, height));
        int nextW = Math.max(1, (int) Math.round(width * scale));
        int nextH = Math.max(1, (int) Math.round(height * scale));
        BufferedImage canvas = new BufferedImage(nextW, nextH, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = canvas.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, nextW, nextH);
        g.drawImage(source, 0, 0, nextW, nextH, null);
        g.dispose();
        return new Raster(toJpeg(canvas, quality), nextW, nextH);
    }

    static byte[] toJpeg(BufferedImage image, float quality) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            var writers = ImageIO.getImageWritersByFormatName("jpeg");
            var writer = writers.next();
            var ios = ImageIO.createImageOutputStream(out);
            writer.setOutput(ios);
            var param = writer.getDefaultWriteParam();
            param.setCompressionMode(javax.imageio.ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(quality);
            writer.write(null, new javax.imageio.IIOImage(image, null, null), param);
            writer.dispose();
            ios.close();
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Unable to encode JPEG", e);
        }
    }
}
