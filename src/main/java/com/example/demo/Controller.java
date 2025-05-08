
    package com.example.demo;

    import org.springframework.web.bind.annotation.GetMapping;
    import org.springframework.web.bind.annotation.RestController;

    @RestController
    public class Controller {

        @GetMapping("/test")
        public String testEndpoint() {
            return "Test endpoint hit!";
        }
    }
    