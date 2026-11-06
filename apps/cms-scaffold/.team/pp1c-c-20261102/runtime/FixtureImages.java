import java.awt.image.BufferedImage;
import java.nio.file.*;
import javax.imageio.ImageIO;
public final class FixtureImages {
    public static void main(String[] args) throws Exception {
        if (args.length != 1 || Runtime.version().feature() != 25) throw new IllegalArgumentException();
        Path output = Path.of(args[0]);
        Files.createDirectory(output);
        String[] names = {"public", "replacement", "draft", "private", "deleted"};
        for (int n = 0; n < names.length; n++) {
            var image = new BufferedImage(32, 16, BufferedImage.TYPE_INT_RGB);
            for (int x = 0; x < 32; x++) for (int y = 0; y < 16; y++)
                image.setRGB(x, y, ((n + 1) * 31 + x * 7) << 16 | (y * 13 + n * 19) << 8 | (x + y + n * 37));
            if (!ImageIO.write(image, "png", output.resolve(names[n] + ".png").toFile())) throw new IllegalStateException();
        }
    }
}
