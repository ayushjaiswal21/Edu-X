document.addEventListener('DOMContentLoaded', function () {
    const chatbox = document.getElementById('chatbox');
    const userMessage = document.getElementById('userMessage');
    const sendBtn = document.getElementById('sendBtn');
    const topicInput = document.getElementById('topicInput');
    const setTopicBtn = document.getElementById('setTopicBtn');
    const backToDashboard = document.getElementById('backToDashboard');
    const quizContainer = document.getElementById('quizContainer');
    const quizQuestion = document.getElementById('quizQuestion');
    const quizOptions = document.getElementById('quizOptions');
    const submitQuizAnswer = document.getElementById('submitQuizAnswer');
    const progressFill = document.getElementById('progressFill');
    const difficultyLevel = document.getElementById('difficultyLevel');
    const correctAnswersDisplay = document.getElementById('correctAnswers');
    const incorrectAnswersDisplay = document.getElementById('incorrectAnswers');
    
    // State management
    let currentTopic = '';
    let chatStage = 'ask_topic';
    let difficulty = 1;
    let rapidQuizTimeout = null;
    let currentQuestion = null;
    let questionStartTime = null;
    let questionHistory = [];
    let correctAnswers = 0;
    let incorrectAnswers = 0;
    
    // Settings
    const RAPID_QUIZ_INTERVAL = 120000; // 2 minutes between rapid quizzes
    const RAPID_QUIZ_TIMER = 10000; // 10 seconds to answer rapid quiz
    let rapidQuizTimerDisplay = null;
    let rapidQuizCountdown = null;
    let rapidQuizStartTime = null;

    // Update UI functions
    function updateProgressDisplay() {
        // Update difficulty level text
        const difficultyLabels = ['Beginner', 'Intermediate', 'Advanced'];
        difficultyLevel.textContent = `Difficulty: ${difficultyLabels[difficulty - 1]}`;
        
        // Update progress bar
        const totalQuestions = correctAnswers + incorrectAnswers;
        const progressPercentage = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
        progressFill.style.width = `${progressPercentage}%`;
        
        // Update counters
        correctAnswersDisplay.innerHTML = `<i class="fas fa-check"></i> ${correctAnswers}`;
        incorrectAnswersDisplay.innerHTML = `<i class="fas fa-times"></i> ${incorrectAnswers}`;
    }

    setTopicBtn.addEventListener('click', function () {
        const topic = topicInput.value.trim();
        if (topic) {
            currentTopic = topic;
            appendMessage('user', `Topic: ${currentTopic}`);
            userMessage.disabled = false;
            sendBtn.disabled = false;
            topicInput.disabled = true;
            setTopicBtn.disabled = true;
            chatStage = 'introduction';
            
            // Request an introduction to the topic
            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: currentTopic,
                    message: `I want to learn about ${currentTopic}`,
                    stage: 'introduction',
                    difficulty: difficulty
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.response) {
                    appendMessage('system', data.response);
                    // After introduction, generate the first question
                    setTimeout(getNextQuestion, 1000);
                }
            })
            .catch(error => {
                console.error('Error during introduction:', error);
                appendMessage('system', 'Sorry, there was an error connecting to the server. Please try again.');
            });
            
            // Start the rapid quiz timer
            startRapidQuizTimer();
        } else {
            appendMessage('system', 'Please enter a valid topic.');
        }
    });

    sendBtn.addEventListener('click', function () {
        const message = userMessage.value.trim();
        if (!message) return;
        
        appendMessage('user', message);
        
        if (currentQuestion) {
            // Student is answering a question
            const responseTime = (Date.now() - questionStartTime) / 1000;
            
            // Send the student's answer for evaluation
            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: currentTopic,
                    message: message,
                    question: currentQuestion.question,
                    expected_answer: currentQuestion.correct_answer,
                    response_time: responseTime,
                    start_time: questionStartTime / 1000,
                    stage: 'evaluation',
                    difficulty: difficulty
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.response) appendMessage('system', data.response);
                
                // Track student performance
                if (data.is_correct) {
                    correctAnswers++;
                    // Increase difficulty after several correct answers
                    if (correctAnswers % 3 === 0 && difficulty < 3) {
                        difficulty++;
                        appendMessage('system', `Great progress! I'll make the questions a bit more challenging.`);
                    }
                } else {
                    incorrectAnswers++;
                    // Decrease difficulty if struggling
                    if (incorrectAnswers % 3 === 0 && difficulty > 1) {
                        difficulty--;
                        appendMessage('system', `Let's try some slightly easier questions to build your confidence.`);
                    }
                }
                
                // Update UI
                updateProgressDisplay();
                
                // Get the next question after a short delay
                setTimeout(getNextQuestion, 2000);
            })
            .catch(error => {
                console.error('Error during evaluation:', error);
                appendMessage('system', 'Sorry, there was an error evaluating your answer. Let\'s continue with another question.');
                setTimeout(getNextQuestion, 2000);
            });
            
            currentQuestion = null;
        } else {
            // General chat (not answering a specific question)
            sendChat(message);
        }
        
        userMessage.value = '';
    });

    userMessage.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    backToDashboard.addEventListener('click', function () {
        window.location.href = '/dashboard';
    });

    function sendChat(message) {
        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic: currentTopic,
                message: message,
                stage: chatStage,
                difficulty: difficulty
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.response) appendMessage('system', data.response);
            if (data.stage) chatStage = data.stage;
            if (data.difficulty) difficulty = data.difficulty;
            
            updateProgressDisplay();
            
            // If the user asks a general question, still continue with learning path
            if (chatStage !== 'evaluation') {
                setTimeout(getNextQuestion, 3000);
            }
        })
        .catch(error => {
            console.error('Error in chat:', error);
            appendMessage('system', 'Sorry, there was an error. Please try again.');
        });
    }
    
    function getNextQuestion() {
        fetch('/api/get_questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic: currentTopic,
                level: ['beginner', 'intermediate', 'advanced'][difficulty - 1]
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data && data.length > 0) {
                currentQuestion = data[0];
                questionStartTime = Date.now();
                
                // Remember this question to avoid repetition
                questionHistory.push(currentQuestion.question);
                if (questionHistory.length > 10) questionHistory.shift();
                
                // Format the question nicely
                let questionText = `<div class="edu-question">
                    <p><strong>Question:</strong> ${currentQuestion.question}</p>
                    <p>Please select from these options:</p>
                    <ol>
                        ${currentQuestion.options.map(opt => `<li>${opt}</li>`).join('')}
                    </ol>
                </div>`;
                
                appendMessage('system', questionText);
            } else {
                appendMessage('system', "I'm having trouble generating a question. Let's talk more about " + 
                    currentTopic + ". What aspect would you like to explore?");
            }
        })
        .catch(error => {
            console.error('Error getting questions:', error);
            appendMessage('system', 'Sorry, I had trouble generating a question. Let\'s continue our discussion about ' + currentTopic);
        });
    }

    function appendMessage(sender, message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        messageDiv.innerHTML = `<div class="message-content">${message}</div>`;
        chatbox.appendChild(messageDiv);
        chatbox.scrollTop = chatbox.scrollHeight;
    }

    function startRapidQuizTimer() {
        if (rapidQuizTimeout) clearTimeout(rapidQuizTimeout);
        rapidQuizTimeout = setTimeout(showRapidQuiz, RAPID_QUIZ_INTERVAL);
    }

    function showRapidQuiz() {
        fetch('/api/rapid_quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: currentTopic })
        })
        .then(response => response.json())
        .then(data => {
            quizContainer.style.display = 'block';
            quizQuestion.textContent = data.question;
            quizOptions.innerHTML = '';
            
            // Record the start time for the rapid quiz
            rapidQuizStartTime = Date.now();
            
            // Create timer display
            const timerDiv = document.createElement('div');
            timerDiv.className = 'rapid-quiz-timer';
            timerDiv.textContent = '10';
            quizQuestion.appendChild(timerDiv);
            rapidQuizTimerDisplay = timerDiv;
            
            let timeLeft = RAPID_QUIZ_TIMER / 1000;
            let currentQuizData = data; // Store quiz data for later use
            
            // Start countdown
            rapidQuizCountdown = setInterval(() => {
                timeLeft--;
                if (rapidQuizTimerDisplay) {
                    rapidQuizTimerDisplay.textContent = timeLeft;
                    if (timeLeft <= 3) {
                        rapidQuizTimerDisplay.classList.add('timer-urgent');
                    }
                }
                
                if (timeLeft <= 0) {
                    clearInterval(rapidQuizCountdown);
                    handleRapidQuizTimeout(currentQuizData);
                }
            }, 1000);
            
            data.options.forEach(option => {
                const btn = document.createElement('button');
                btn.className = 'quiz-option';
                btn.textContent = option;
                btn.onclick = function () {
                    document.querySelectorAll('.quiz-option').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    submitQuizAnswer.style.display = 'block';
                    submitQuizAnswer.onclick = function () {
                        clearInterval(rapidQuizCountdown);
                        const responseTime = (Date.now() - rapidQuizStartTime) / 1000;
                        const isCorrect = option === data.correct;
                        
                        // Save the rapid quiz result to server
                        saveRapidQuizResult(data.question, option, data.correct, isCorrect, responseTime);
                        
                        if (isCorrect) {
                            correctAnswers++;
                            appendMessage('system', '<div class="quiz-result correct">Correct! Well done!</div>');
                        } else {
                            incorrectAnswers++;
                            appendMessage('system', `<div class="quiz-result incorrect">The correct answer was: ${data.correct}</div>`);
                        }
                        
                        updateProgressDisplay();
                        
                        quizContainer.style.display = 'none';
                        submitQuizAnswer.style.display = 'none';
                        
                        // Restart the rapid quiz timer
                        startRapidQuizTimer();
                    };
                };
                quizOptions.appendChild(btn);
            });
        })
        .catch(error => {
            console.error('Error showing rapid quiz:', error);
            // Don't show an error message, just retry later
            startRapidQuizTimer();
        });
    }
    
    function handleRapidQuizTimeout(quizData) {
        const responseTime = RAPID_QUIZ_TIMER / 1000; // Maximum time
        
        // Save the timed-out quiz as incorrect
        saveRapidQuizResult(quizData.question, "No answer", quizData.correct, false, responseTime);
        incorrectAnswers++;
        updateProgressDisplay();
        
        appendMessage('system', `<div class="quiz-result timeout">Time's up! The correct answer was: ${quizData.correct}</div>`);
        quizContainer.style.display = 'none';
        submitQuizAnswer.style.display = 'none';
        
        // Restart the rapid quiz timer
        startRapidQuizTimer();
    }
    
    function saveRapidQuizResult(question, userAnswer, correctAnswer, isCorrect, responseTime) {
        fetch('/api/save_rapid_quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic: currentTopic,
                question: question,
                user_answer: userAnswer,
                correct_answer: correctAnswer,
                is_correct: isCorrect,
                response_time: responseTime
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Rapid quiz result saved:', data);
        })
        .catch(error => {
            console.error('Error saving rapid quiz result:', error);
        });
    }
    
    // Initialize progress display on load
    updateProgressDisplay();
});