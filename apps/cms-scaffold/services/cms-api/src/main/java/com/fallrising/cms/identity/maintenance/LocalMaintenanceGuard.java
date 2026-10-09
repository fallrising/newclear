package com.fallrising.cms.identity.maintenance;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.security.auth.module.UnixSystem;
import java.nio.file.*;
import java.nio.channels.FileChannel;
import java.util.*;
import java.time.Instant;
import java.security.MessageDigest;
import java.util.concurrent.TimeUnit;
import static java.nio.file.LinkOption.NOFOLLOW_LINKS;
import static com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.*;

public final class LocalMaintenanceGuard implements MaintenanceGuard, MaintenanceGuard.ConnectionPhase {
    @FunctionalInterface interface HelperRunner { int run(List<String> argv, Path cwd); }
    private static final ObjectMapper JSON = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private static final String TARGET = "version,runId,targetId,project,sourceCommit,apiBuild,images,containerIds,networkIds,volumeNames,databaseOid,ingressScriptSha256,nodeBinarySha256,mediaProbeSha256";
    private static final String EXTRA = "connection,operationId,operation,releaseId,phase,boundBackend,createdAt";
    private static final Set<String> PHASES = Set.of("RESERVED","PRE_CONNECTION","BOUND","COMMITTED","COMPLETE","FAILED_OR_UNKNOWN");
    private final Path leaseFile, nodeBinary, guardScript, component;
    private final String targetId, runId;
    private final UUID operationId;
    private final Map<String,String> environment;
    private final HelperRunner runner;
    private JsonNode pinned, backendPin;
    public LocalMaintenanceGuard(Path leaseFile, Path nodeBinary, Path guardScript, String targetId, UUID operationId) {
        this(leaseFile,nodeBinary,guardScript,targetId,operationId,System.getenv(),LocalMaintenanceGuard::execute);
    }
    LocalMaintenanceGuard(Path leaseFile, Path nodeBinary, Path guardScript, String targetId, UUID operationId, Map<String,String> environment, HelperRunner runner) {
        this.leaseFile=leaseFile;this.nodeBinary=nodeBinary;this.guardScript=guardScript;this.targetId=targetId;this.operationId=operationId;
        this.environment=Map.copyOf(environment);this.runner=runner;
        require(targetId!=null&&targetId.matches("^pp1-local:[a-f0-9]{32}$")&&operationId!=null);
        runId=targetId.substring(10);Path base=leaseFile;for(int i=0;i<5;i++){base=base.getParent();require(base!=null);}component=base;
        require(component.isAbsolute()&&component.normalize().equals(component));
        require(leaseFile.equals(component.resolve("local/pp1/"+runId+"/maintenance/lease.json"))&&guardScript.equals(component.resolve("scripts/local/maintenance-guard.mjs")));
    }
    static MaintenanceGuard fromEnvironment(Options options, Map<String,String> environment, Path cwd) {
        var names=List.of("CMS_MAINTENANCE_RUN_ID","CMS_MAINTENANCE_NODE_BINARY","CMS_MAINTENANCE_NODE_SHA256","CMS_MAINTENANCE_GUARD_SHA256");
        long present=names.stream().filter(environment::containsKey).count();if(present==0)return MaintenanceGuard.defaultDeny();
        try {
            require(present==names.size()&&names.stream().allMatch(k->environment.get(k)!=null&&!environment.get(k).isBlank()));
            String run=environment.get(names.getFirst());require(run.matches("^[a-f0-9]{32}$")&&options.targetId().equals("pp1-local:"+run));
            require(cwd.isAbsolute()&&cwd.normalize().equals(cwd));var node=Path.of(environment.get("CMS_MAINTENANCE_NODE_BINARY"));require(node.isAbsolute()&&node.normalize().equals(node));
            var guard=new LocalMaintenanceGuard(cwd.resolve("local/pp1/"+run+"/maintenance/lease.json"),node,cwd.resolve("scripts/local/maintenance-guard.mjs"),options.targetId(),options.operationId(),environment,LocalMaintenanceGuard::execute);
            var state=guard.readLease();require(text(state,"phase").equals("PRE_CONNECTION")&&text(state,"operation").equals(options.operation().name()));return guard;
        } catch(Throwable failure){throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN);}
    }
    private static void require(boolean value) { if(!value)throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN); }
    private static String text(JsonNode node,String field) { var value=node.get(field);require(value!=null&&value.isTextual());return value.textValue(); }
    private static void keys(JsonNode value,String names) {
        require(value!=null&&value.isObject());var expected=Set.of(names.split(","));require(value.size()==expected.size());expected.forEach(k->require(value.has(k)));
    }
    private static boolean hex(String value,int size) { return value.matches("^[a-f0-9]{"+size+"}$"); }
    private static boolean image(String value) { return value.matches("^sha256:[a-f0-9]{64}$"); }
    private static boolean privateIp(String ip) {
        if(!ip.matches("^(?:0|[1-9][0-9]{0,2})(?:\\.(?:0|[1-9][0-9]{0,2})){3}$"))return false;
        int[] p=Arrays.stream(ip.split("\\.")).mapToInt(Integer::parseInt).toArray();
        return Arrays.stream(p).allMatch(n->n<=255)&&(p[0]==10||p[0]==172&&p[1]>=16&&p[1]<=31||p[0]==192&&p[1]==168);
    }
    private static void canonicalUuid(String value) { require(UUID.fromString(value).toString().equals(value)); }
    private static void ancestors(Path path) throws Exception {
        require(path.isAbsolute()&&path.normalize().equals(path));Path current=path.getRoot();
        for(Path part:path){current=current.resolve(part);require(!Files.isSymbolicLink(current));}
    }
    private static long uid() { return new UnixSystem().getUid(); }
    private static void directory(Path path) throws Exception {
        ancestors(path);require(Files.isDirectory(path,NOFOLLOW_LINKS));
        require(((Number)Files.getAttribute(path,"unix:uid",NOFOLLOW_LINKS)).longValue()==uid()&&(((Number)Files.getAttribute(path,"unix:mode",NOFOLLOW_LINKS)).intValue()&07777)==0700);
    }
    private static byte[] bytes(Path path,boolean privateFile) throws Exception {
        ancestors(path);if(privateFile)directory(path.getParent());
        require(Files.isRegularFile(path,NOFOLLOW_LINKS)&&((Number)Files.getAttribute(path,"unix:nlink",NOFOLLOW_LINKS)).longValue()==1);
        if(privateFile)require(((Number)Files.getAttribute(path,"unix:uid",NOFOLLOW_LINKS)).longValue()==uid()&&(((Number)Files.getAttribute(path,"unix:mode",NOFOLLOW_LINKS)).intValue()&07777)==0600);
        Object identity=Files.readAttributes(path,java.nio.file.attribute.BasicFileAttributes.class,NOFOLLOW_LINKS).fileKey();
        try(var channel=FileChannel.open(path,Set.of(StandardOpenOption.READ,NOFOLLOW_LINKS))){
            require(channel.size()<=(privateFile?1048576:268435456));var buffer=java.nio.ByteBuffer.allocate((int)channel.size());
            while(buffer.hasRemaining())require(channel.read(buffer)>=0);require(channel.size()==buffer.capacity());
            require(Objects.equals(identity,Files.readAttributes(path,java.nio.file.attribute.BasicFileAttributes.class,NOFOLLOW_LINKS).fileKey()));return buffer.array();
        }
    }
    private static String digest(Path path) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes(path,false))); }
    private JsonNode readLease() {
        try {
            directory(leaseFile.getParent().getParent());directory(leaseFile.getParent());directory(leaseFile.getParent().resolve("operations"));directory(leaseFile.getParent().resolve("operation.lock"));
            var state=JSON.readTree(bytes(leaseFile,true));keys(state,TARGET+","+EXTRA);
            require(state.get("version").isIntegralNumber()&&state.get("version").canConvertToInt()&&state.get("version").intValue()==1&&text(state,"runId").equals(runId)&&text(state,"targetId").equals(targetId));
            require(text(state,"project").equals("cms-pp1-local-"+runId)&&hex(text(state,"sourceCommit"),40));
            var build=state.get("apiBuild");keys(build,"sourceCommit,jarSha256,baseImage");require(text(build,"sourceCommit").equals(text(state,"sourceCommit"))&&hex(text(build,"jarSha256"),64)&&image(text(build,"baseImage")));
            for(var pair:Map.of("images","api,node,postgres","containerIds","postgres,cms-api,ingress","networkIds","web,data").entrySet()){
                var group=state.get(pair.getKey());keys(group,pair.getValue());for(String key:pair.getValue().split(","))require(pair.getKey().equals("images")?image(text(group,key)):hex(text(group,key),64));
            }
            var volumes=state.get("volumeNames");keys(volumes,"db-data,media-data");for(String key:List.of("db-data","media-data"))require(text(volumes,key).equals(text(state,"project")+"_"+key));
            require(state.get("databaseOid").isIntegralNumber()&&state.get("databaseOid").canConvertToLong()&&state.get("databaseOid").longValue()>0&&state.get("databaseOid").longValue()<=4294967295L);
            for(String key:List.of("ingressScriptSha256","nodeBinarySha256","mediaProbeSha256"))require(hex(text(state,key),64));
            require(text(state,"operationId").equals(operationId.toString())&&Set.of("FRESH_INIT","RECOVER_ADMIN").contains(text(state,"operation"))&&PHASES.contains(text(state,"phase")));
            require(text(state,"releaseId").equals("sha256:"+text(build,"jarSha256")));canonicalUuid(text(state,"operationId"));
            String created=text(state,"createdAt");require(created.matches("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"));Instant.parse(created);
            var connection=state.get("connection");keys(connection,"jdbcUrl,dataGateway");require(privateIp(text(connection,"dataGateway")));
            String url=text(connection,"jdbcUrl"),prefix="jdbc:postgresql://",suffix=":5432/cms";require(url.startsWith(prefix)&&url.endsWith(suffix)&&privateIp(url.substring(prefix.length(),url.length()-suffix.length())));
            var backend=state.get("boundBackend");
            if(backend.isNull())require(Set.of("RESERVED","PRE_CONNECTION","FAILED_OR_UNKNOWN").contains(text(state,"phase")));
            else {
                keys(backend,"pid,backendStartEpoch,db,role,clientAddr,applicationName");require(backend.get("pid").isIntegralNumber()&&backend.get("pid").canConvertToInt()&&backend.get("pid").intValue()>0);
                require(text(backend,"backendStartEpoch").matches("^[1-9][0-9]*\\.[0-9]+$")&&text(backend,"db").equals("cms")&&text(backend,"role").equals("cms_local")&&text(backend,"clientAddr").equals(text(connection,"dataGateway"))&&text(backend,"applicationName").equals(operationId.toString()));
                require(!Set.of("RESERVED","PRE_CONNECTION").contains(text(state,"phase")));
                if(backendPin==null)backendPin=backend.deepCopy();else require(backendPin.equals(backend));
            }
            var target=JSON.readTree(bytes(leaseFile.resolveSibling("target.json"),true));keys(target,TARGET);for(String key:TARGET.split(","))require(target.get(key).equals(state.get(key)));
            var journal=JSON.readTree(bytes(leaseFile.getParent().resolve("operations/"+operationId+".json"),true));keys(journal,"operationId,operation,targetId,releaseId,phase,at,failureCode");
            for(String key:List.of("operationId","operation","targetId","releaseId","phase"))require(journal.get(key).equals(state.get(key)));Instant.parse(text(journal,"at"));
            require(journal.get("failureCode").isNull()||Set.of("QUIESCENCE_NOT_PROVEN","COMMITTED_HOST_RESTORE_FAILED").contains(text(journal,"failureCode")));
            require(runId.equals(environment.get("CMS_MAINTENANCE_RUN_ID"))&&nodeBinary.toString().equals(environment.get("CMS_MAINTENANCE_NODE_BINARY")));
            String nodeSha=digest(nodeBinary);require(nodeSha.equals(text(state,"nodeBinarySha256"))&&nodeSha.equals(environment.get("CMS_MAINTENANCE_NODE_SHA256"))&&digest(guardScript).equals(environment.get("CMS_MAINTENANCE_GUARD_SHA256")));
            var stable=state.deepCopy();((ObjectNode)stable).remove(List.of("phase","boundBackend"));if(pinned==null)pinned=stable;else require(pinned.equals(stable));return state;
        } catch(Throwable failure) { if(failure instanceof Failure known)throw known;throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN); }
    }
    private void helper(String phase,String verb,String...flags) {
        var state=readLease();require(text(state,"phase").equals(phase));var argv=new ArrayList<>(List.of(nodeBinary.toString(),guardScript.toString(),verb,"--run-id",runId,"--operation-id",operationId.toString()));argv.addAll(List.of(flags));
        try{require(runner.run(List.copyOf(argv),component)==0);}catch(Throwable failure){throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN);}
    }
    private static int execute(List<String> argv,Path cwd) {
        Process process=null;
        try {
            var builder=new ProcessBuilder(argv).directory(cwd.toFile()).redirectInput(Path.of("/dev/null").toFile()).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD);
            builder.environment().clear();builder.environment().putAll(Map.of("PATH","/usr/bin:/bin","LANG","C.UTF-8"));process=builder.start();
            if(!process.waitFor(30,TimeUnit.SECONDS)){process.destroy();if(!process.waitFor(1,TimeUnit.SECONDS)){process.destroyForcibly();process.waitFor(1,TimeUnit.SECONDS);}throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN);}
            return process.exitValue();
        } catch(InterruptedException failure){Thread.currentThread().interrupt();throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN);}
        catch(Exception failure){throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN);}
        finally{if(process!=null&&process.isAlive())process.destroyForcibly();}
    }
    @Override public ConnectionPhase connectionPhase() { return this; }
    @Override public void assertPreConnection() {
        var state=readLease();require(text(state,"phase").equals("PRE_CONNECTION"));assertDataSourceDestination(environment.get("SPRING_DATASOURCE_URL"),environment.get("SPRING_DATASOURCE_USERNAME"));helper("PRE_CONNECTION","assert","--phase","pre-connection");
    }
    @Override public void bindBackend(int pid,String epoch) {
        require(pid>0&&epoch!=null&&epoch.matches("^[1-9][0-9]*\\.[0-9]+$"));helper("PRE_CONNECTION","bind-backend","--pid",Integer.toString(pid),"--backend-start-epoch",epoch);
    }
    @Override public void assertBound() { helper("BOUND","assert","--phase","bound"); }
    void assertDataSourceDestination(String jdbcUrl,String username) {
        var state=readLease();require(text(state,"phase").equals("PRE_CONNECTION")&&text(state.get("connection"),"jdbcUrl").equals(jdbcUrl)&&"cms_local".equals(username));
    }
    @Override public Lease acquire(String target,UUID operation,Operation mode) {
        if(mode==Operation.RECOVER_ADMIN)throw new Failure(FailureCode.RECOVERY_BACKUP_REQUIRED);
        var state=readLease();require(targetId.equals(target)&&operationId.equals(operation)&&text(state,"operation").equals(mode.name()));assertBound();return new AttachedLease(text(state,"releaseId"));
    }
    private final class AttachedLease implements Lease {
        private final String release;private boolean closed;
        AttachedLease(String release){this.release=release;}
        @Override public String targetId(){return targetId;}
        @Override public String releaseId(){return release;}
        @Override public String backupId(){return null;}
        @Override public void assertQuiesced(){require(!closed);assertBound();}
        @Override public void recordCommitted(Result result) {
            try {
                require(!closed);assertBound();var state=readLease();require(text(state,"phase").equals("BOUND")&&result!=null&&operationId.equals(result.operationId())&&result.operation()!=null&&text(state,"operation").equals(result.operation().name())&&targetId.equals(result.targetId())&&release.equals(result.releaseId())&&result.principalId()!=null&&result.completedAt()!=null&&result.completedAt().toString().matches("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$"));
                var wire=new LinkedHashMap<String,String>();wire.put("operationId",operationId.toString());wire.put("operation",result.operation().name());wire.put("principalId",result.principalId().toString());wire.put("completedAt",result.completedAt().toString());wire.put("releaseId",release);wire.put("targetId",targetId);
                var parent=leaseFile.getParent().resolve("operations");directory(parent);var path=parent.resolve(operationId+".result.json");ancestors(path);
                var output=java.nio.ByteBuffer.wrap((JSON.writeValueAsString(wire)+"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                try(var channel=FileChannel.open(path,Set.of(StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,NOFOLLOW_LINKS),java.nio.file.attribute.PosixFilePermissions.asFileAttribute(java.nio.file.attribute.PosixFilePermissions.fromString("rw-------")))) {
                    while(output.hasRemaining())channel.write(output);channel.force(true);
                }
                try(var channel=FileChannel.open(parent,Set.of(StandardOpenOption.READ,NOFOLLOW_LINKS))){channel.force(true);}
                require(JSON.readTree(bytes(path,true)).equals(JSON.valueToTree(wire)));
            } catch(Throwable failure){throw new Failure(FailureCode.COMMITTED_HOST_RESTORE_FAILED);}
        }
        @Override public void close(){if(!closed)try{assertBound();}finally{closed=true;}}
    }
}
