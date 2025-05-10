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

    // Conversation state for advanced flow
    let conversationState = {
        stage: 'introduction',
        history: [],
        currentQuestion: '',
        thinkingTime: 0,
        startTime: null
    };

    // Update UI functions
    function updateProgressDisplay() {
        const difficultyLabels = ['Beginner', 'Intermediate', 'Advanced'];
        difficultyLevel.textContent = `Difficulty: ${difficultyLabels[difficulty - 1]}`;
        const totalQuestions = correctAnswers + incorrectAnswers;
        const progressPercentage = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
        progressFill.style.width = `${progressPercentage}%`;
        correctAnswersDisplay.innerHTML = `<i class="fas fa-check"></i> ${correctAnswers}`;
        incorrectAnswersDisplay.innerHTML = `<i class="fas fa-times"></i> ${incorrectAnswers}`;
    }

    // Add a message to the chat
    function appendMessage(sender, message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        messageDiv.innerHTML = `<div class="message-content">${message}</div>`;
        chatbox.appendChild(messageDiv);
        chatbox.scrollTop = chatbox.scrollHeight;
    }

    // Markdown to HTML (basic)
    function markdownToHtml(text) {
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        text = text.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
        text = text.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
        text = text.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
        text = text.replace(/^\- (.*?)$/gm, '<li>$1</li>');
        text = text.replace(/<\/li>\n<li>/g, '</li><li>');
        text = text.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
        text = text.replace(/\n/g, '<br>');
        return text;
    }

    // Replace loading message with final message
    function updateLoadingMessage(loadingElement, finalMessage) {
        const formattedMessage = markdownToHtml(finalMessage);
        loadingElement.innerHTML = `<div class="message-content">${formattedMessage}</div>`;
        chatbox.scrollTop = chatbox.scrollHeight;
    }

    // Fetch bot response from API (advanced flow)
    function fetchBotResponse(requestData) {
        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        })
            .then(response => response.json())
            .then(data => {
                // Remove loading indicator
                const loadingMessages = chatbox.querySelectorAll('.loading-indicator');
                if (loadingMessages.length > 0) {
                    loadingMessages[loadingMessages.length - 1].parentElement.innerHTML =
                        `<div class="message-content">${markdownToHtml(data.response)}</div>`;
                } else {
                    appendMessage('system', markdownToHtml(data.response));
                }

                // Update conversation state
                conversationState.stage = data.stage || conversationState.stage;
                if (data.response) conversationState.history.push(data.response);

                // Show rapid quiz after every response except during introduction
                if (conversationState.stage !== 'introduction') {
                    setTimeout(() => {
                        showRapidQuiz(() => {
                            // After rapid quiz, enable user input for next response
                            userMessage.disabled = false;
                            userMessage.placeholder = "Type your response here...";
                            userMessage.focus();
                        });
                    }, 1500);
                } else {
                    // If it's introduction, just enable user input
                    setTimeout(() => {
                        userMessage.disabled = false;
                        userMessage.placeholder = "Type your response here...";
                        userMessage.focus();
                    }, 1000);
                }
            })
            .catch(error => {
                console.error('Error:', error);
                appendMessage('system', "Sorry, I encountered an error. Please try again.");
                userMessage.disabled = false;
            });
    }

    // Show rapid quiz and call callback after completion
function showRapidQuiz(callback) {
    // Clear any existing timers
    if (rapidQuizTimeout) {
        clearTimeout(rapidQuizTimeout);
    }
    if (rapidQuizCountdown) {
        clearInterval(rapidQuizCountdown);
    }

    // Get the current subject from the URL
    const urlParams = new URLSearchParams(window.location.search);
    const currentSubject = urlParams.get('subject') || 'gk';

    fetch('/api/rapid_quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            topic: currentTopic,
            subject: currentSubject
        })
    })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    throw new Error(data.error);
                }

                appendMessage('system', '<div class="edu-question">Quick Quiz Time! 🎯</div>');
                quizContainer.style.display = 'block';
                quizQuestion.textContent = data.question;
                quizOptions.innerHTML = '';
                rapidQuizStartTime = Date.now();

                // Create timer display
                const timerDiv = document.createElement('div');
                timerDiv.className = 'rapid-quiz-timer';
                timerDiv.textContent = '10';
                quizQuestion.appendChild(timerDiv);
                rapidQuizTimerDisplay = timerDiv;

                let timeLeft = RAPID_QUIZ_TIMER / 1000;
                let currentQuizData = data;

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
                        handleRapidQuizTimeout(currentQuizData, callback);
                    }
                }, 1000);

                // Create options buttons
                data.options.forEach(option => {
                    const btn = document.createElement('button');
                    btn.className = 'quiz-option';
                    btn.textContent = option;
                    btn.onclick = function () {
                        clearInterval(rapidQuizCountdown);
                        const responseTime = (Date.now() - rapidQuizStartTime) / 1000;
                        const isCorrect = option === data.correct;

                        saveRapidQuizResult(data.question, option, data.correct, isCorrect, responseTime);

                        if (isCorrect) {
                            correctAnswers++;
                            appendMessage('system', '<div class="quiz-result correct">Correct! Well done! ✨</div>');
                        } else {
                            incorrectAnswers++;
                            appendMessage('system', `<div class="quiz-result incorrect">The correct answer was: ${data.correct}</div>`);
                        }

                        updateProgressDisplay();
                        quizContainer.style.display = 'none';
                        if (typeof callback === 'function') {
                            setTimeout(callback, 1500);
                        }
                    };
                    quizOptions.appendChild(btn);
                });
            })
            .catch(error => {
                console.error('Error showing rapid quiz:', error);
                if (typeof callback === 'function') {
                    callback();
                }
            });
    }

    function handleRapidQuizTimeout(quizData, callback) {
        const responseTime = RAPID_QUIZ_TIMER / 1000;
        saveRapidQuizResult(quizData.question, "No answer", quizData.correct, false, responseTime);
        incorrectAnswers++;
        updateProgressDisplay();
        appendMessage('system', `<div class="quiz-result timeout">Time's up! The correct answer was: ${quizData.correct}</div>`);
        quizContainer.style.display = 'none';
        submitQuizAnswer.style.display = 'none';
        if (typeof callback === 'function') callback();
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

    // Handle user message submission (advanced flow)
    function handleUserMessage() {
        const message = userMessage.value.trim();
        if (!message) return;
        if (conversationState.startTime) {
            conversationState.thinkingTime = (Date.now() - conversationState.startTime) / 1000;
        }
        appendMessage('user', message);
        userMessage.value = '';
        userMessage.disabled = true;
        appendMessage('system', '<div class="loading-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>');
        let nextStage = conversationState.stage;
        if (conversationState.stage === 'awaiting_answer') {
            nextStage = 'evaluate_response';
        }
        const requestData = {
            topic: currentTopic,
            stage: nextStage,
            message: message,
            history: conversationState.history,
            previous_question: conversationState.currentQuestion,
            response_time: conversationState.thinkingTime
        };
        fetchBotResponse(requestData);
    }

    // Set topic and start chat
    setTopicBtn.addEventListener('click', function () {
        const topic = topicInput.value.trim();
        if (topic) {
            currentTopic = topic;
            appendMessage('user', `Topic: ${currentTopic}`);
            userMessage.disabled = true;
            sendBtn.disabled = false;
            topicInput.disabled = true;
            setTopicBtn.disabled = true;
            conversationState.stage = 'introduction';
            conversationState.history = [];
            conversationState.currentQuestion = '';
            conversationState.thinkingTime = 0;
            conversationState.startTime = null;
            // Start chat with introduction
            fetchBotResponse({
                topic: currentTopic,
                stage: 'introduction',
                message: 'start',
                history: []
            });
        } else {
            appendMessage('system', 'Please enter a valid topic.');
        }
    });

    sendBtn.addEventListener('click', handleUserMessage);

    userMessage.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

    backToDashboard && backToDashboard.addEventListener('click', function () {
        window.location.href = '/dashboard';
    });

    // Initialize progress display on load
    updateProgressDisplay();

    // Add summarize button (optional)
    const actionBar = document.createElement('div');
    actionBar.classList.add('action-bar');
    actionBar.innerHTML = `
        <button id="summarize-button" class="action-button">
            <i class="fas fa-book"></i> Summarize what we've learned
        </button>
    `;
    chatbox.parentElement.appendChild(actionBar);

    document.getElementById('summarize-button').addEventListener('click', function () {
        userMessage.disabled = true;
        appendMessage('system', '<div class="loading-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>');
        fetchBotResponse({
            topic: currentTopic,
            stage: 'summary',
            message: 'summarize',
            history: conversationState.history
        });
    });
});