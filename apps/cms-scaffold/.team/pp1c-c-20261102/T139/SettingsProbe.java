import java.net.URLClassLoader;
import java.nio.file.Path;
import java.time.Duration;
public final class SettingsProbe {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException();
        try (var loader = new URLClassLoader(new java.net.URL[]{Path.of(args[0]).toUri().toURL()}, ClassLoader.getPlatformClassLoader())) {
            Class<?> type = Class.forName("com.fallrising.cms.identity.IdentityProperties", true, loader);
            Object settings = type.getConstructor().newInstance();
            Duration absolute = (Duration) type.getMethod("getSessionAbsolute").invoke(settings);
            Duration maximum = (Duration) type.getMethod("getSessionMax").invoke(settings);
            if (absolute.isNegative() || absolute.isZero() || absolute.getNano() != 0
                    || maximum.isNegative() || maximum.isZero() || maximum.getNano() != 0) throw new IllegalStateException();
            System.out.println("{\"sessionAbsoluteSeconds\":\"" + absolute.getSeconds()
                    + "\",\"sessionMaxSeconds\":\"" + maximum.getSeconds() + "\"}");
        }
    }
}
