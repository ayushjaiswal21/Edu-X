import os
import re
import sqlite3
import logging
import time
from datetime import datetime
from difflib import SequenceMatcher
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.exceptions import HTTPException
import random
from modules.llm_handler import LLMHandler
import json  
from modules.summarize import Summarizer
from markupsafe import escape
import requests

llm = LLMHandler()

# Logging setup
os.makedirs('logs', exist_ok=True)
os.makedirs('database', exist_ok=True)
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('logs/app.log', mode='a')
    ]
)
logger = logging.getLogger(__name__)

CONFIG = {
    'DATABASE_PATH': 'database/edu_chat.db',
    'REQUIRE_EMAIL_VERIFICATION': False,
    'PASSWORD_MIN_LENGTH': 8,
    'SESSION_TIMEOUT_MINUTES': 30,
    'SUBJECT_MODELS': {
        'math': 'wizard-math:7b',
        'science': 'dolphin-mistral:latest',
        'history': 'mistral-openorca:latest',
        'english': 'mistral:7b-instruct',  # <-- colon, not dash
        'gk': 'mistral:7b-instruct'        # <-- colon, not dash
}
}

PROMPT_TEMPLATES_DIR = "modules/prompts"

def load_prompt_templates():
    """Load all prompt templates from files"""
    templates = {}
    for subject in CONFIG['SUBJECT_MODELS'].keys():
        try:
            with open(f"{PROMPT_TEMPLATES_DIR}/{subject}.txt", "r", encoding='utf-8') as f:
                content = f.read()
                templates[subject] = content
        except FileNotFoundError:
            logger.warning(f"No prompt template found for {subject}")
            templates[subject] = f"You are an expert {subject} tutor. Please provide detailed and helpful responses."
    return templates

PROMPT_TEMPLATES = load_prompt_templates()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(24).hex())

USER_DB_PATH = 'database/user_data.db'
EDU_DB_PATH = 'database/edu_chat.db'

def init_db():
    """Initialize user-related tables in user_data.db"""
    try:
        db_path = USER_DB_PATH
        os.makedirs('database', exist_ok=True)
        with sqlite3.connect(db_path) as conn:
            cursor = conn.cursor()
            # Users table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE,
                    password_hash TEXT NOT NULL,
                    is_verified BOOLEAN DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_login DATETIME
                )
            ''')
            # User progress table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS user_progress (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    topic TEXT,
                    correct_count INTEGER DEFAULT 0,
                    incorrect_count INTEGER DEFAULT 0,
                    avg_response_time REAL DEFAULT 0,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
            ''')
            # Interactions table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    topic TEXT,
                    question TEXT,
                    answer TEXT,
                    is_correct BOOLEAN,
                    response_time REAL,
                    model_used TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
            ''')
            # Add a new table for rapid quiz responses
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS rapid_quiz_responses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    topic TEXT,
                    question TEXT,
                    user_answer TEXT,
                    correct_answer TEXT,
                    is_correct BOOLEAN,
                    response_time REAL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
            ''')
            conn.commit()
            logger.info(f"Database {db_path} initialized successfully")
    except Exception as e:
        logger.critical(f"Database initialization failed for {db_path}: {str(e)}")
        raise
init_db()
def init_models():
    """Initialize/check LLM models if needed. Currently a placeholder."""
    # You can add model download/check logic here if needed.
    logger.info("init_models called (no-op placeholder).")
init_models()
summarizer = Summarizer()

def validate_email(email):
    """Validate email format"""
    return re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", email)

def validate_password(password):
    """Validate password strength"""
    if len(password) < CONFIG['PASSWORD_MIN_LENGTH']:
        return False, f"Password must be at least {CONFIG['PASSWORD_MIN_LENGTH']} characters"
    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter"
    if not re.search(r"\d", password):
        return False, "Password must contain at least one number"
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        return False, "Password must contain at least one special character"
    return True, ""

def get_db_connection(db_path=USER_DB_PATH):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

# Authentication Routes
@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'GET':
        return render_template('auth/signup.html')
    try:
        data = request.form if request.form else request.get_json()
        username = data.get('username', '').strip()
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        confirm_password = data.get('confirm_password', '')
        if not all([username, email, password, confirm_password]):
            raise ValueError("All fields are required")
        if password != confirm_password:
            raise ValueError("Passwords do not match")
        if not validate_email(email):
            raise ValueError("Invalid email format")
        is_valid, pw_error = validate_password(password)
        if not is_valid:
            raise ValueError(pw_error)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM users WHERE username = ? OR email = ?",
                (username, email)
            )
            if cursor.fetchone():
                raise ValueError("Username or email already exists")
            password_hash = generate_password_hash(password)
            cursor.execute(
                "INSERT INTO users (username, email, password_hash, is_verified) VALUES (?, ?, ?, ?)",
                (username, email, password_hash, not CONFIG['REQUIRE_EMAIL_VERIFICATION'])
            )
            user_id = cursor.lastrowid
            conn.commit()
        if not CONFIG['REQUIRE_EMAIL_VERIFICATION']:
            session['user_id'] = user_id
            session['username'] = username
            logger.info(f"New user registered: {username}")
            return jsonify({
                'success': True,
                'message': 'Registration successful',
                'redirect': url_for('dashboard')
            })
        return jsonify({
            'success': True,
            'message': 'Registration successful. Please check your email to verify your account.'
        })
    except Exception as e:
        logger.error(f"Signup error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        return render_template('auth/login.html')
    try:
        data = request.form if request.form else request.get_json()
        username_or_email = data.get('username', '').strip()
        password = data.get('password', '')
        remember_me = data.get('remember_me', False)
        if not username_or_email or not password:
            raise ValueError("Username/email and password are required")
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, username, password_hash, is_verified FROM users WHERE username = ? OR email = ?",
                (username_or_email, username_or_email)
            )
            user = cursor.fetchone()
            if not user or not check_password_hash(user['password_hash'], password):
                raise ValueError("Invalid credentials")
            if CONFIG['REQUIRE_EMAIL_VERIFICATION'] and not user['is_verified']:
                raise ValueError("Please verify your email before logging in")
            cursor.execute(
                "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
                (user['id'],)
            )
            conn.commit()
        session['user_id'] = user['id']
        session['username'] = user['username']
        logger.info(f"User logged in: {user['username']}")
        return jsonify({
            'success': True,
            'message': 'Login successful',
            'redirect': url_for('dashboard')
        })
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 401

@app.route('/logout')
def logout():
    try:
        username = session.get('username', 'unknown')
        session.clear()
        logger.info(f"User logged out: {username}")
        return redirect(url_for('login'))
    except Exception as e:
        logger.error(f"Logout error: {str(e)}")
        return redirect(url_for('login'))

@app.route('/')
def home():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('home.html')

@app.route('/dashboard')
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT topic, correct_count, incorrect_count, avg_response_time FROM user_progress WHERE user_id = ?",
                (session['user_id'],)
            )
            progress_data = cursor.fetchall()
        return render_template('dashboard.html', progress_data=progress_data)
    except Exception as e:
        logger.error(f"Dashboard error: {str(e)}")
        return redirect(url_for('login'))

# These are the modified/new route functions to add to app.py

@app.route('/chatbot')
def chatbot():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    subject = request.args.get('subject', 'math').lower()
    if subject not in CONFIG['SUBJECT_MODELS']:
        return redirect(url_for('dashboard'))
    initial_message = f"Welcome to the {subject.title()} learning session! Please specify a topic you'd like to learn about."
    return render_template(
        'chatbot.html',
        subject=subject,
        initial_message=initial_message,
        username=session.get('username', 'User')
    )

@app.route('/api/chat', methods=['POST'])
def handle_chat():
    if not llm.server_available:
        return jsonify({'error': 'Ollama server is not available. Chat functionality is disabled.'}), 503
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    try:
        data = request.json
        user_id = session['user_id']
        topic = data.get('topic', 'math')
        user_message = data.get('message', '').strip()
        chat_stage = data.get('stage', 'question')
        
        # Handle different stages of the conversation
        if chat_stage == 'introduction':
            # Generate an introduction to the topic
            prompt_template = PROMPT_TEMPLATES.get(topic, PROMPT_TEMPLATES['math'])
            formatted_prompt = LLMHandler.format_prompt(
                prompt_template,
                {
                    "TOPIC": topic,
                    "LEVEL": "beginner",
                    "USER_QUERY": f"Introduce the topic of {topic} briefly. After introducing, explain why this topic is important and how we will learn it step by step."
                }
            )
        elif chat_stage == 'evaluation':
            # Evaluate a student's answer
            question = data.get('question', '')
            expected_answer = data.get('expected_answer', '').strip()
            start_time = data.get('start_time', time.time())
            response_time = time.time() - float(start_time)
            
            # Use text similarity instead of exact match
            is_correct = similar_answers(user_message.lower(), expected_answer.lower())
            
            prompt_template = PROMPT_TEMPLATES.get(topic, PROMPT_TEMPLATES['math'])
            formatted_prompt = LLMHandler.format_prompt(
                prompt_template,
                {
                    "TOPIC": topic,
                    "LEVEL": "beginner",
                    "USER_QUERY": f"Student answered: '{user_message}'\n"
                                f"Original question: '{question}'\n"
                                f"Expected answer: '{expected_answer}'\n"
                                f"Response time: {response_time:.1f} seconds\n"
                                f"Provide detailed feedback on their answer, highlighting what they got right and what needs improvement. End with an encouraging message."
                }
            )
            
            # Record the interaction in the database
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO interactions 
                    (user_id, topic, question, answer, is_correct, response_time, model_used)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    user_id,
                    topic,
                    question,
                    user_message,
                    is_correct,
                    response_time,
                    CONFIG['SUBJECT_MODELS'].get(topic, CONFIG['SUBJECT_MODELS']['math'])
                ))
                
                # Update user progress
                cursor.execute('''
                    SELECT id FROM user_progress 
                    WHERE user_id = ? AND topic = ?
                ''', (user_id, topic))
                progress = cursor.fetchone()
                
                if progress:
                    # Update existing progress
                    cursor.execute('''
                        UPDATE user_progress
                        SET correct_count = correct_count + ?,
                            incorrect_count = incorrect_count + ?,
                            avg_response_time = (avg_response_time + ?) / 2
                        WHERE user_id = ? AND topic = ?
                    ''', (
                        1 if is_correct else 0,
                        0 if is_correct else 1,
                        response_time,
                        user_id,
                        topic
                    ))
                else:
                    # Create new progress record
                    cursor.execute('''
                        INSERT INTO user_progress
                        (user_id, topic, correct_count, incorrect_count, avg_response_time)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (
                        user_id,
                        topic,
                        1 if is_correct else 0,
                        0 if is_correct else 1,
                        response_time
                    ))
                conn.commit()
        else:
            # General chat about the topic
            prompt_template = PROMPT_TEMPLATES.get(topic, PROMPT_TEMPLATES['math'])
            formatted_prompt = LLMHandler.format_prompt(
                prompt_template,
                {
                    "TOPIC": topic,
                    "LEVEL": "beginner",
                    "USER_QUERY": f"User asked: {user_message}\n"
                                 f"Respond as a knowledgeable and encouraging teacher. Provide a helpful explanation related to {topic}."
                }
            )
        
        # Generate the LLM response
        model = CONFIG['SUBJECT_MODELS'].get(topic, CONFIG['SUBJECT_MODELS']['math'])
        llm_response = llm.generate_response(
            prompt=formatted_prompt,
            system_prompt="You are an expert educational assistant specializing in interactive teaching. Your goal is to help students understand concepts through clear explanations and guided practice.",
            model=model
        )
        
        response_data = {
            'response': llm_response,
            'stage': chat_stage
        }
        
        if chat_stage == 'evaluation':
            response_data['is_correct'] = is_correct
            response_data['response_time'] = response_time
        
        return jsonify(response_data)
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/rapid_quiz', methods=['POST'])
def rapid_quiz():
    if not llm.server_available:
        return jsonify({'error': 'Ollama server is not available.'}), 503
    try:
        data = request.get_json() or {}
        topic = data.get('topic', 'gk').lower()
        # Fallback to 'gk' if topic is not in config
        model = CONFIG['SUBJECT_MODELS'].get(topic, CONFIG['SUBJECT_MODELS']['gk'])
        prompt = (
            f"Generate a single rapid-fire multiple choice question in the topic '{topic}'. "
            "The question should be very easy, clear and concise, with exactly 4 options (one correct). "
            "It should be something a student can answer within 10 seconds if they know the basic concepts. "
            "Return the result as JSON with these exact keys: question, options, correct_answer."
        )
        system_prompt = "You are an expert educational quiz generator. Only return the JSON."
        response = llm.generate_response(
            prompt=prompt,
            system_prompt=system_prompt,
            model=model
        )
        
        # Improved JSON extraction 
        try:
            # First try: direct JSON parsing if the response is already clean JSON
            try:
                question_data = json.loads(response)
                logger.debug("Successfully parsed response as direct JSON")
            except json.JSONDecodeError:
                # Second try: Clean up markdown and find JSON block
                cleaned_response = re.sub(r"```json|```", "", response, flags=re.MULTILINE).strip()
                json_match = re.search(r'\{.*\}', cleaned_response, re.DOTALL)
                if json_match:
                    question_data = json.loads(json_match.group())
                    logger.debug("Successfully extracted JSON from markdown/text")
                else:
                    raise ValueError("Could not find valid JSON in response")
            
            required_keys = {'question', 'options', 'correct_answer'}
            if not all(k in question_data for k in required_keys):
                missing = required_keys - question_data.keys()
                raise ValueError(f"Missing required fields: {missing}")
                
            return jsonify({
                'question': question_data['question'],
                'options': question_data['options'],
                'correct': question_data['correct_answer']
            })
        except Exception as e:
            logger.error(f"Rapid quiz JSON parse error: {str(e)} | LLM response: {response}")
            # Fallback: return a static question
            return jsonify({
                'question': f"Quick! What's a key concept in {topic}?",
                'options': ["Concept A", "Concept B", "Concept C", "Concept D"],
                'correct': "Concept A"
            })
    except Exception as e:
        logger.error(f"Rapid quiz error: {str(e)}")
        return jsonify({'error': str(e)}), 500

# New utility function for more flexible answer comparison
def similar_answers(answer1, answer2):
    """
    Compare two answers with some flexibility using sequence matcher
    Returns True if they are similar enough, False otherwise
    """
    # Exact match
    if answer1 == answer2:
        return True
    
    # Normalize answers for comparison
    norm_answer1 = re.sub(r'[^\w\s]', '', answer1.lower()).strip()
    norm_answer2 = re.sub(r'[^\w\s]', '', answer2.lower()).strip()
    
    # Check for normalized exact match
    if norm_answer1 == norm_answer2:
        return True
    
    # Check for high similarity
    similarity = SequenceMatcher(None, norm_answer1, norm_answer2).ratio()
    if similarity > 0.85:  # Adjust this threshold as needed
        return True
    
    # Check if one is a subset of the other
    if norm_answer1 in norm_answer2 or norm_answer2 in norm_answer1:
        return True
    
    # For numerical answers, check if they're close
    try:
        num1 = float(norm_answer1)
        num2 = float(norm_answer2)
        if abs(num1 - num2) < 0.001 * max(abs(num1), abs(num2)):
            return True
    except ValueError:
        pass
    
    return False

@app.route('/api/save_rapid_quiz', methods=['POST'])
def save_rapid_quiz():
    """Save the results of a rapid quiz to the database using SQLite directly."""
    try:
        # Check authentication
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({'status': 'error', 'message': 'User not authenticated'}), 401
            
        # Extract data from request
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            
        topic = data.get('topic')
        question = data.get('question')
        user_answer = data.get('user_answer')
        correct_answer = data.get('correct_answer')
        is_correct = data.get('is_correct', False)
        response_time = data.get('response_time', 0)
        
        # Validate required data
        if not all([topic, question, correct_answer]):
            return jsonify({'status': 'error', 'message': 'Missing required data'}), 400
            
        # Save to database using SQLite
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO rapid_quiz_responses
                    (user_id, topic, question, user_answer, correct_answer, is_correct, response_time, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', (
                    user_id,
                    topic,
                    question,
                    user_answer,
                    correct_answer,
                    is_correct,
                    response_time
                ))
                conn.commit()
                
            return jsonify({
                'status': 'success',
                'message': 'Rapid quiz result saved successfully'
            })
        except sqlite3.Error as e:
            logger.error(f"Database error saving rapid quiz: {str(e)}")
            return jsonify({'status': 'error', 'message': f'Database error: {str(e)}'}), 500
        
    except Exception as e:
        logger.error(f"Error saving rapid quiz result: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/get_questions', methods=['POST'])
def get_questions():
    if not llm.server_available:
        return jsonify({"error": "Ollama server is not available. Questions cannot be generated at this time."}), 503
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        topic = data.get('topic', 'math').lower()
        level = data.get('level', 'beginner').lower()
        if topic not in CONFIG['SUBJECT_MODELS']:
            return jsonify({"error": f"Invalid topic: {topic}"}), 400
        prompt_template = PROMPT_TEMPLATES.get(topic)
        if not prompt_template:
            logger.error(f"No prompt template found for topic: {topic}")
            return jsonify({"error": "Configuration error"}), 500
        try:
            formatted_prompt = LLMHandler.format_prompt(
                prompt_template,
                {
                    "TOPIC": topic,
                    "LEVEL": level,
                    "USER_QUERY": """Generate a multiple choice question with:
- A clear question
- 4 options (1 correct)
- Explanation
Format as JSON with these exact keys: question, options, correct_answer, explanation"""
                }
            )
        except Exception as e:
            logger.error(f"Prompt formatting failed: {str(e)}")
            return jsonify({"error": "Prompt generation failed"}), 500
        model = CONFIG['SUBJECT_MODELS'].get(topic)
        try:
            response = llm.generate_response(
                prompt=formatted_prompt,
                system_prompt="You are creating educational content. Provide only the JSON response.",
                model=model
            )
            logger.debug(f"Raw LLM response for topic '{topic}': {response}")
            try:
                # First try direct JSON parsing
                try:
                    question = json.loads(response)
                except json.JSONDecodeError:
                    # Then try to extract JSON from text/markdown
                    cleaned_response = re.sub(r"```json|```", "", response, flags=re.MULTILINE).strip()
                    json_match = re.search(r'\{.*\}', cleaned_response, re.DOTALL)
                    if not json_match:
                        raise ValueError("No JSON block found in the response")
                    clean_response = json_match.group()
                    question = json.loads(clean_response)
                
                required_keys = {'question', 'options', 'correct_answer', 'explanation'}
                if not all(key in question for key in required_keys):
                    missing = required_keys - question.keys()
                    raise ValueError(f"Missing required fields: {missing}")
                if not isinstance(question['options'], list) or len(question['options']) != 4:
                    raise ValueError("Options must be a list of 4 items")
                if question['correct_answer'] not in question['options']:
                    logger.warning("Correct answer not in options. Adjusting response.")
                    question['correct_answer'] = question['options'][0]
                return jsonify([question])
            except json.JSONDecodeError as e:
                logger.error(f"JSON parse error: {str(e)}. Response: {response}")
                return jsonify({
                    "error": "The AI returned an invalid format",
                    "fallback_question": {
                        'question': "Explain the key concepts of " + topic,
                        'options': ['Concept 1', 'Concept 2', 'Concept 3', 'Concept 4'],
                        'correct_answer': 'Concept 1',
                        'explanation': 'The AI response could not be parsed'
                    }
                }), 502
        except requests.exceptions.Timeout:
            logger.error("LLM request timed out")
            return jsonify({"error": "The AI is taking too long to respond"}), 504
        except Exception as e:
            logger.error(f"LLM request failed: {str(e)}")
            return jsonify({"error": "Failed to generate question"}), 500
    except Exception as e:
        logger.error(f"Unexpected error in question generation: {str(e)}")
        return jsonify({"error": "An unexpected error occurred"}), 500

@app.route('/api/generate_test', methods=['POST'])
def generate_test():
    if not llm.server_available:
        return jsonify({"error": "Ollama server is not available. Test generation cannot proceed."}), 503
    try:
        if not request.is_json:
            return jsonify({"error": "Request must be JSON"}), 400
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        subject = data.get('subject', '').strip().lower()
        topic = data.get('topic', '').strip()
        question_count = data.get('count', 5)
        if not subject:
            return jsonify({"error": "Subject is required"}), 400
        if subject not in CONFIG['SUBJECT_MODELS']:
            valid_subjects = ', '.join(CONFIG['SUBJECT_MODELS'].keys())
            return jsonify({"error": f"Invalid subject: '{subject}'. Valid subjects are: {valid_subjects}"}), 400
        if not topic:
            return jsonify({"error": "Topic is required"}), 400
        if not isinstance(question_count, int) or question_count <= 0:
            return jsonify({"error": "Count must be a positive integer"}), 400
        model = CONFIG['SUBJECT_MODELS'].get(subject)
        prompt_template = PROMPT_TEMPLATES.get(subject)
        if not prompt_template:
            logger.error(f"No prompt template found for subject: {subject}")
            return jsonify({"error": "Configuration error"}), 500
        formatted_prompt = LLMHandler.format_prompt(
            prompt_template,
            {
                "TOPIC": topic,
                "LEVEL": "intermediate",
                "USER_QUERY": f"""
Generate {question_count} multiple choice questions about {topic} in the context of {subject}.
Each question should include:
- A clear and concise question
- Exactly 4 options (one correct)
- An explanation for the correct answer
Return the result as a JSON array with this structure:
[
  {{
    "question": "Question text",
    "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
    "correct_answer": "Option X",
    "explanation": "Explanation text"
  }},
  ...
]
"""
            }
        )
        
        response = llm.generate_response(
            prompt=formatted_prompt,
            system_prompt="You are creating educational content. Provide only the JSON response.",
            model=model
        )
        logger.debug(f"Raw LLM response for subject '{subject}', topic '{topic}': {response}")
        
        # Improved JSON extraction with better error handling
        try:
            # First try direct JSON parsing
            try:
                questions_data = json.loads(response)
                if not isinstance(questions_data, list):
                    # If response is a JSON object but not a list, see if it has 'questions' key
                    if isinstance(questions_data, dict) and 'questions' in questions_data:
                        questions_data = questions_data['questions']
                    else:
                        raise ValueError("Response is not a JSON array or doesn't contain questions")
            except json.JSONDecodeError:
                # Try to extract JSON array from text/markdown
                cleaned_response = re.sub(r"```json|```", "", response, flags=re.MULTILINE).strip()
                json_match = re.search(r'\[.*\]', cleaned_response, re.DOTALL)
                if json_match:
                    json_str = json_match.group()
                    questions_data = json.loads(json_str)
                else:
                    # If no array found, try to see if there's a JSON object with a questions array
                    object_match = re.search(r'\{.*\}', cleaned_response, re.DOTALL)
                    if object_match:
                        json_obj = json.loads(object_match.group())
                        if isinstance(json_obj, dict) and 'questions' in json_obj:
                            questions_data = json_obj['questions']
                        else:
                            raise ValueError("No questions array found in JSON object")
                    else:
                        raise ValueError("No valid JSON found in the response")
            
            # Validate the questions data
            if not isinstance(questions_data, list):
                raise ValueError(f"Expected a list of questions, got {type(questions_data)}")
            
            if len(questions_data) == 0:
                raise ValueError("No questions were generated")
                
            # Validate each question
            for i, q in enumerate(questions_data):
                if not isinstance(q, dict):
                    logger.warning(f"Question {i} is not a dictionary: {q}")
                    continue
                    
                # Check for required fields
                required_keys = ['question', 'options', 'correct_answer', 'explanation']
                missing_keys = [key for key in required_keys if key not in q]
                if missing_keys:
                    logger.warning(f"Question {i} missing keys: {missing_keys}")
                    # Add missing keys with placeholder values
                    for key in missing_keys:
                        if key == 'options':
                            q[key] = ["Option A", "Option B", "Option C", "Option D"]
                        elif key == 'correct_answer':
                            q[key] = "Option A"
                        else:
                            q[key] = f"Missing {key}"
                
                # Ensure options is a list
                if 'options' in q and not isinstance(q['options'], list):
                    logger.warning(f"Question {i} options is not a list: {q['options']}")
                    q['options'] = [str(q['options'])]
                
                # Ensure exactly 4 options
                if 'options' in q:
                    while len(q['options']) < 4:
                        q['options'].append(f"Option {len(q['options']) + 1}")
                    if len(q['options']) > 4:
                        logger.warning(f"Question {i} has {len(q['options'])} options, truncating to 4")
                        q['options'] = q['options'][:4]
                
                # Ensure correct_answer is one of the options
                if 'correct_answer' in q and 'options' in q and q['correct_answer'] not in q['options']:
                    logger.warning(f"Question {i} correct answer '{q['correct_answer']}' not in options")
                    q['correct_answer'] = q['options'][0]
            
            return jsonify(questions_data)
            
        except Exception as e:
            logger.error(f"Failed to parse questions data: {str(e)}")
            # Provide fallback questions
            fallback_questions = [{
                "question": f"What is an important concept in {topic}?",
                "options": ["Concept A", "Concept B", "Concept C", "Concept D"],
                "correct_answer": "Concept A",
                "explanation": f"This is a fallback question. The AI response could not be parsed: {str(e)}"
            }]
            return jsonify(fallback_questions)
            
    except Exception as e:
        logger.error(f"Error in generate_test: {str(e)}")
        return jsonify({"error": f"Failed to generate test: {str(e)}"}), 500

@app.route('/api/get_analytics')
def get_analytics():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    try:
        user_id = session['user_id']
        
        # For debugging
        logger.debug(f"Fetching analytics for user_id: {user_id}")
        
        with get_db_connection() as conn:
            # Ensure the connection returns rows as dictionaries
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Check if user has any progress data
            cursor.execute('''
                SELECT COUNT(*) as count FROM user_progress WHERE user_id = ?
            ''', (user_id,))
            progress_count = cursor.fetchone()['count']
            
            if progress_count == 0:
                logger.info(f"No progress data found for user_id: {user_id}")
                empty_progress = []
            else:
                # Fetch progress data 
                cursor.execute('''
                    SELECT topic, 
                           SUM(correct_count) as correct_count,
                           SUM(incorrect_count) as incorrect_count,
                           AVG(avg_response_time) as avg_response_time,
                           (SUM(correct_count) * 100.0 / (SUM(correct_count) + SUM(incorrect_count))) as accuracy
                    FROM user_progress
                    WHERE user_id = ?
                    GROUP BY topic
                ''', (user_id,))
                progress_data = []
                for row in cursor.fetchall():
                    row_dict = dict(row)
                    # Handle potential NaN or None in accuracy
                    if row_dict['accuracy'] is None or math.isnan(row_dict['accuracy']):
                        row_dict['accuracy'] = 0.0
                    progress_data.append(row_dict)
            
            # Check if user has any interaction data
            cursor.execute('''
                SELECT COUNT(*) as count FROM interactions WHERE user_id = ?
            ''', (user_id,))
            interactions_count = cursor.fetchone()['count']
            
            if interactions_count == 0:
                logger.info(f"No interaction data found for user_id: {user_id}")
                recent_interactions = []
            else:
                # Fetch recent interactions
                cursor.execute('''
                    SELECT topic, question, answer, is_correct, response_time, 
                           datetime(timestamp, 'localtime') as formatted_time
                    FROM interactions
                    WHERE user_id = ?
                    ORDER BY timestamp DESC
                    LIMIT 10
                ''', (user_id,))
                recent_interactions = [dict(row) for row in cursor.fetchall()]
            
            # Get summary stats
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_interactions,
                    SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as total_correct,
                    AVG(response_time) as avg_response_time,
                    COUNT(DISTINCT topic) as topics_practiced
                FROM interactions
                WHERE user_id = ?
            ''', (user_id,))
            summary = dict(cursor.fetchone() or {})
            
            # Handle empty summary case
            if not summary or summary.get('total_interactions', 0) == 0:
                summary = {
                    'total_interactions': 0,
                    'total_correct': 0,
                    'avg_response_time': 0,
                    'topics_practiced': 0,
                    'accuracy': 0
                }
            else:
                # Calculate overall accuracy
                if summary['total_interactions'] > 0 and summary['total_correct'] is not None:
                    summary['accuracy'] = (summary['total_correct'] * 100.0) / summary['total_interactions']
                else:
                    summary['accuracy'] = 0
            
            # Get rapid quiz stats
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_quizzes,
                    SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as quizzes_correct,
                    AVG(response_time) as quiz_avg_time,
                    COUNT(DISTINCT topic) as quiz_topics
                FROM rapid_quiz_responses
                WHERE user_id = ?
            ''', (user_id,))
            quiz_stats = dict(cursor.fetchone() or {})
            
            # Handle empty quiz stats
            if not quiz_stats or quiz_stats.get('total_quizzes', 0) == 0:
                quiz_stats = {
                    'total_quizzes': 0,
                    'quizzes_correct': 0, 
                    'quiz_avg_time': 0,
                    'quiz_topics': 0,
                    'quiz_accuracy': 0
                }
            else:
                # Calculate quiz accuracy
                if quiz_stats['total_quizzes'] > 0 and quiz_stats['quizzes_correct'] is not None:
                    quiz_stats['quiz_accuracy'] = (quiz_stats['quizzes_correct'] * 100.0) / quiz_stats['total_quizzes']
                else:
                    quiz_stats['quiz_accuracy'] = 0
        
        # Round floating point values for better display
        for stat_dict in [summary, quiz_stats] + progress_data:
            for key, value in stat_dict.items():
                if isinstance(value, float):
                    stat_dict[key] = round(value, 2)
        
        # Combine all data in response
        response_data = {
            'success': True,
            'progress': progress_data if progress_count > 0 else [],
            'recent_interactions': recent_interactions,
            'summary': summary,
            'quiz_stats': quiz_stats
        }
        
        logger.debug(f"Successfully retrieved analytics for user_id: {user_id}")
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Analytics error: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e),
            'message': 'Failed to retrieve analytics data'
        }), 500

@app.route('/api/summarize', methods=['POST'])
def summarize_text():
    try:
        data = request.get_json()
        text = data.get('text', '')
        max_length = data.get('length', 50)
        summary = summarizer.summarize(text, max_length)
        return jsonify({'summary': summary})
    except Exception as e:
        logger.error(f"Summarization error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def page_not_found(e):
    return render_template('errors/404.html'), 404

@app.errorhandler(403)
def forbidden(e):
    return render_template('errors/403.html'), 403

@app.errorhandler(500)
def internal_error(e):
    return render_template('errors/500.html'), 500

@app.errorhandler(HTTPException)
def handle_exception(e):
    return render_template('errors/generic.html', error=e), e.code

if __name__ == '__main__':
    os.makedirs('templates/auth', exist_ok=True)
    os.makedirs('templates/errors', exist_ok=True)
    os.makedirs('static/css', exist_ok=True)
    os.makedirs('static/js', exist_ok=True)
    app.run(host='0.0.0.0', port=5000, debug=True)