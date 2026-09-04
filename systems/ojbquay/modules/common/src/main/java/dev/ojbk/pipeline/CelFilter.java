package dev.ojbk.pipeline;

import com.google.protobuf.ByteString;
import dev.cel.common.CelAbstractSyntaxTree;
import dev.cel.common.types.ListType;
import dev.cel.common.types.MapType;
import dev.cel.common.types.SimpleType;
import dev.cel.compiler.CelCompiler;
import dev.cel.compiler.CelCompilerFactory;
import dev.cel.runtime.CelRuntime;
import dev.cel.runtime.CelRuntimeFactory;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class CelFilter implements AutoCloseable {
    private static final int MAX_COMPILED_EXPRESSIONS = 256;
    private static final Duration EVALUATION_TIMEOUT = Duration.ofMillis(10);

    private final CelCompiler compiler = CelCompilerFactory.standardCelCompilerBuilder()
            .addVar("key", SimpleType.STRING)
            .addVar("tags", ListType.create(SimpleType.STRING))
            .addVar("headers", MapType.create(SimpleType.STRING, SimpleType.STRING))
            .addVar("body", SimpleType.DYN)
            .addVar("bodyRaw", SimpleType.BYTES)
            .build();
    private final CelRuntime runtime = CelRuntimeFactory.plannerRuntimeBuilder().build();
    private final Map<String, CelRuntime.Program> programs =
            new LinkedHashMap<>(16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, CelRuntime.Program> eldest) {
                    return size() > MAX_COMPILED_EXPRESSIONS;
                }
            };
    private final Semaphore evaluations = new Semaphore(256);
    private final ExecutorService executor =
            Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("cel-eval-", 0).factory());

    public boolean matches(String expression, MessageVariables variables) {
        if (expression == null || expression.isBlank()) {
            return true;
        }
        if (!evaluations.tryAcquire()) {
            return false;
        }

        Future<Boolean> evaluation = null;
        try {
            CelRuntime.Program program = program(expression);
            evaluation = executor.submit(() -> Boolean.TRUE.equals(program.eval(Map.of(
                    "key", variables.key(),
                    "tags", variables.tags(),
                    "headers", variables.headers(),
                    "body", variables.body(),
                    "bodyRaw", ByteString.copyFrom(variables.bodyRaw())))));
            return evaluation.get(EVALUATION_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        } catch (ExecutionException | TimeoutException | RuntimeException exception) {
            if (evaluation != null) {
                evaluation.cancel(true);
            }
            return false;
        } finally {
            evaluations.release();
        }
    }

    public void validate(String expression) {
        if (expression != null && !expression.isBlank()) {
            program(expression);
        }
    }

    private CelRuntime.Program program(String expression) {
        synchronized (programs) {
            return programs.computeIfAbsent(expression, this::compile);
        }
    }

    private CelRuntime.Program compile(String expression) {
        try {
            CelAbstractSyntaxTree syntaxTree = compiler.compile(expression).getAst();
            return runtime.createProgram(syntaxTree);
        } catch (Exception exception) {
            throw new IllegalArgumentException("invalid CEL expression", exception);
        }
    }

    @Override
    public void close() {
        executor.close();
    }
}
