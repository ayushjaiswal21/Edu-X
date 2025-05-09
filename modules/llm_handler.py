import requests
import json
import logging
from typing import Dict
import time
import re

logger = logging.getLogger(__name__)

class LLMHandler:
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.temperature = 0.7
        self.max_tokens = 500
        self.timeout = 120  # 2 minutes
        self.max_retries = 2
        self.retry_delay = 5
        self.server_available = self._verify_connection()

    def _verify_connection(self) -> bool:
        """Verify Ollama is running with increased timeout"""
        try:
            response = requests.get(
                f"{self.base_url}/api/tags",
                timeout=self.timeout
            )
            if response.status_code != 200:
                logger.error("Ollama connection failed - is the service running?")
                return False
            logger.info("Connected to Ollama successfully")
            return True
        except Exception as e:
            logger.warning(f"Ollama connection error: {str(e)}")
            return False

    @staticmethod
    def format_prompt(template: str, replacements: Dict[str, str]) -> str:
        """Format prompt template with replacements"""
        try:
            for key, value in replacements.items():
                template = template.replace(f"{{{{{key}}}}}", str(value))
            return template
        except Exception as e:
            logger.error(f"Prompt formatting failed: {str(e)}")
            return template

    def generate_response(self, prompt: str, system_prompt: str, model: str) -> str:
        """Generate response with retry logic and increased timeout"""
        if not self.server_available:
            logger.warning("Ollama server is not available. Cannot generate response.")
            return "The AI service is currently unavailable. Please try again later."

        for attempt in range(self.max_retries + 1):
            try:
                # Verify model is available first
                response = requests.get(
                    f"{self.base_url}/api/tags",
                    timeout=self.timeout
                )
                response.raise_for_status()
                tags_data = response.json()
                
                # Improved model availability check
                available_models = []
                if 'models' in tags_data:
                    available_models = [m['name'] for m in tags_data['models']]
                
                # More flexible model name matching
                model_base_name = model.split(":")[0]
                
                # Log model information for debugging
                logger.debug(f"Requested model: {model}, base name: {model_base_name}")
                logger.debug(f"Available models: {available_models}")
                
                # First try exact match
                if model in available_models:
                    model_available = True
                    logger.debug(f"Exact model match found for {model}")
                # Then try base name match
                elif any(m.startswith(model_base_name) for m in available_models):
                    matching_models = [m for m in available_models if m.startswith(model_base_name)]
                    logger.debug(f"Base name matches found: {matching_models}")
                    # If no exact match but base name matches, use the first matching model
                    model = matching_models[0]
                    model_available = True
                    logger.info(f"Using model {model} as match for requested {model_base_name}")
                else:
                    model_available = False
                
                if not model_available:
                    if available_models:
                        # Fall back to first available model
                        fallback_model = available_models[0]
                        logger.warning(
                            f"Model {model} not available. Falling back to: {fallback_model}"
                        )
                        model = fallback_model
                    else:
                        raise ValueError(f"No models available in Ollama")

                # Generate the response with the selected model
                logger.info(f"Generating response using model: {model}")
                response = requests.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": model,
                        "prompt": prompt,
                        "system": system_prompt,
                        "options": {
                            "temperature": self.temperature,
                            "num_ctx": 2048,
                            "repeat_last_n": 0
                        },
                        "stream": False
                    },
                    timeout=self.timeout
                )
                response.raise_for_status()
                result = response.json()
                logger.debug(f"Ollama raw result: {result}")
                
                # Try all possible keys
                if isinstance(result, dict):
                    text = result.get('response') or result.get('message') or result.get('output') or str(result)
                else:
                    text = str(result)
                    
                return self._format_educational_response(text)

            except requests.exceptions.RequestException as e:
                if attempt == self.max_retries:
                    logger.error(f"LLM API request failed after {self.max_retries} attempts: {str(e)}")
                    return "The AI service is taking longer than usual to respond. Please try again later."
                logger.warning(f"Attempt {attempt + 1} failed, retrying in {self.retry_delay} seconds...")
                time.sleep(self.retry_delay)
            except Exception as e:
                logger.error(f"LLM generation failed: {str(e)}")
                return "An error occurred while generating the response. Please try again."

    def _format_educational_response(self, text: str) -> str:
        """Extract and format the first JSON block from the response, or return full text if not found"""
        try:
            logger.debug(f"Raw response text: {text}")
            # Remove markdown code block if present
            text = re.sub(r"^```json|```$", "", text, flags=re.MULTILINE).strip()
            
            # Try to parse as JSON first
            try:
                json_obj = json.loads(text)
                return json.dumps(json_obj)  # Return properly formatted JSON
            except json.JSONDecodeError:
                # If direct parsing fails, try to extract JSON using regex
                json_match = re.search(r'\{.*\}', text, re.DOTALL)
                if json_match:
                    try:
                        json_str = json_match.group()
                        json_obj = json.loads(json_str)
                        return json.dumps(json_obj)  # Return properly formatted JSON
                    except json.JSONDecodeError:
                        logger.warning("Found JSON-like structure but it's not valid JSON.")
                        return text
                else:
                    logger.warning("No JSON block found. Returning raw response.")
                    return text
        except Exception as e:
            logger.error(f"Response formatting failed: {str(e)}")
            return text