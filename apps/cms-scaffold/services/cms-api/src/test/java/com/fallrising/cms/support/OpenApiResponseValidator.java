package com.fallrising.cms.support;

import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import com.atlassian.oai.validator.report.SimpleValidationReportFormat;
import com.atlassian.oai.validator.report.ValidationReport;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.ResultMatcher;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;

/** Validates every MockMvc response against the handwritten OpenAPI document (BD-03). */
public final class OpenApiResponseValidator {

    /** Report keys that mean "this request is not a documented operation"; such responses are not validated. */
    static final Set<String> UNDOCUMENTED_KEYS = Set.of(
            "validation.request.path.missing",
            "validation.request.operation.notAllowed");

    private static final OpenApiInteractionValidator VALIDATOR = create();

    private OpenApiResponseValidator() {}

    public static ResultMatcher conformsToOpenApi() {
        return result -> {
            ValidationReport report = validate(result.getRequest(), result.getResponse());
            if (report.hasErrors()) {
                throw new AssertionError("Response does not match openapi.yaml: "
                        + result.getRequest().getMethod() + " " + result.getRequest().getRequestURI()
                        + " -> " + result.getResponse().getStatus() + "\n"
                        + SimpleValidationReportFormat.getInstance().apply(report));
            }
        };
    }

    public static ValidationReport validate(MockHttpServletRequest request, MockHttpServletResponse response) {
        String path = request.getRequestURI();
        if (!path.startsWith("/api/v1/") && !path.equals("/openapi.yaml") && !path.equals("/actuator/health")) {
            return ValidationReport.empty();
        }
        SimpleResponse.Builder builder = SimpleResponse.Builder.status(response.getStatus());
        if (response.getContentType() != null) {
            builder.withContentType(response.getContentType());
        }
        byte[] body = response.getContentAsByteArray();
        if (body.length > 0) {
            builder.withBody(body);
        }
        ValidationReport report = VALIDATOR.validateResponse(
                path, Request.Method.valueOf(request.getMethod()), builder.build());
        List<ValidationReport.Message> messages = report.getMessages();
        if (!messages.isEmpty() && messages.stream().allMatch(m -> UNDOCUMENTED_KEYS.contains(m.getKey()))) {
            return ValidationReport.empty();
        }
        return report;
    }

    private static OpenApiInteractionValidator create() {
        try {
            String spec = new ClassPathResource("openapi/openapi.yaml").getContentAsString(StandardCharsets.UTF_8);
            return OpenApiInteractionValidator.createForInlineApiSpecification(spec).build();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
