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
                
                # Extract model names from the response
                available_models = []
                if 'models' in tags_data:
                    available_models = [m['name'] for m in tags_data['models']]
                
                # Accept both exact and tag/variant match
                model_base_name = model.split(":")[0]
                model_available = model in available_models or any(m.split(":")[0] == model_base_name for m in available_models)
                
                if not model_available:
                    raise ValueError(f"Model {model} not available. Available: {available_models}")

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
            json_match = re.search(r'\{.*?\}', text, re.DOTALL)
            if not json_match:
                logger.warning("No JSON block found. Returning raw response.")
                return text
            clean_response = json_match.group()
            return clean_response
        except Exception as e:
            logger.error(f"Response formatting failed: {str(e)}")
            return text