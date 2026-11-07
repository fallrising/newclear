import java.nio.file.*; import java.util.zip.*; import java.net.*; import java.awt.image.*; import javax.imageio.*; import java.io.*;
class Profile { public static void main(String[] args) throws Exception {
  if(!Files.readString(Path.of("/probe/input")).equals("synthetic")) throw new Exception();
  try(ZipFile zip=new ZipFile("/app/app.jar")) {
    var entry=zip.stream().filter(e->e.getName().matches("BOOT-INF/lib/postgresql-.*[.]jar")).findFirst().orElseThrow();
    try(var input=zip.getInputStream(entry)){Files.copy(input,Path.of("/tmp/postgresql.jar"));}
  }
  try(var loader=new URLClassLoader(new URL[]{Path.of("/tmp/postgresql.jar").toUri().toURL()})){Class.forName("org.postgresql.Driver",true,loader);}
  var out=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(2,2,BufferedImage.TYPE_INT_RGB),"png",out);
  if(ImageIO.read(new ByteArrayInputStream(out.toByteArray()))==null)throw new Exception();
  try(var files=Files.walk(Path.of("/media"))){if(files.anyMatch(p->!Files.isReadable(p)))throw new Exception();}
  Files.writeString(Path.of("/probe/output/java"),"synthetic",StandardOpenOption.CREATE_NEW);
  System.out.println("{\"javaRuntimeVersion\":\""+System.getProperty("java.runtime.version")+"\",\"jdbc\":true,\"imageio\":true,\"privateFiles\":true,\"mediaReadable\":true}");
}}
