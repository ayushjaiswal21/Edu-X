document.addEventListener('DOMContentLoaded', function () {
    // Initialize
    let refreshTimer = null;
    let isRequestInProgress = false; // Flag to prevent multiple concurrent requests
    let consecutiveErrors = 0; // Track consecutive errors
    const MAX_ERRORS = 5; // Max consecutive errors before stopping auto-refresh
    
    initializeDashboard();

    function initializeDashboard() {
        loadAnalytics();
        setupEventListeners();
        startAutoRefresh();
    }

    function setupEventListeners() {
        // Subject card listeners
        document.querySelectorAll('.subject-card').forEach(card => {
            card.addEventListener('click', function () {
                const subject = this.dataset.subject;
                window.location.href = `/chatbot?subject=${subject}`;
            });
        });

        // Logout button
        document.getElementById('logoutBtn')?.addEventListener('click', function () {
            window.location.href = '/logout';
        });

        // Take Test Button
        document.getElementById('takeTestBtn')?.addEventListener('click', function () {
            document.getElementById('testModal').style.display = 'block';
        });

        // Close Modal Buttons
        document.querySelectorAll('.close-modal').forEach(button => {
            button.addEventListener('click', function () {
                this.closest('.modal').style.display = 'none';
            });
        });

        // Test Form
        document.getElementById('testForm')?.addEventListener('submit', function (e) {
            e.preventDefault();
            const subject = document.getElementById('testSubject').value;
            const topic = document.getElementById('testTopic').value;

            if (subject && topic) {
                document.getElementById('testModal').style.display = 'none';
                document.getElementById('testTitle').textContent = 
                    `${subject.charAt(0).toUpperCase() + subject.slice(1)} - ${topic}`;
                document.getElementById('testInterface').style.display = 'block';
                loadTestQuestions(subject, topic);
            }
        });

        // Summarize Button
        document.getElementById('summarizeBtn')?.addEventListener('click', handleSummarize);
    }

    function startAutoRefresh() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }
        refreshTimer = setInterval(loadAnalytics, 30000);
    }

    function loadAnalytics() {
        // Prevent multiple concurrent requests
        if (isRequestInProgress) {
            console.log('Analytics request already in progress, skipping');
            return;
        }
        
        isRequestInProgress = true;
        
        fetch('/api/get_analytics')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Network response was not ok: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Reset error counter on success
                consecutiveErrors = 0;
                
                if (data.progress) {
                    renderCharts(data.progress);
                }
                if (data.recent_activities) {
                    renderRecentActivity(data.recent_activities);
                }
            })
            .catch(error => {
                console.error('Error loading analytics:', error);
                showNoDataMessage();
                
                // Increment error counter
                consecutiveErrors++;
                
                // If we've hit too many consecutive errors, stop the auto-refresh
                if (consecutiveErrors >= MAX_ERRORS) {
                    console.error('Too many consecutive errors. Stopping auto-refresh.');
                    if (refreshTimer) {
                        clearInterval(refreshTimer);
                        refreshTimer = null;
                    }
                }
            })
            .finally(() => {
                isRequestInProgress = false;
            });
    }

    function showNoDataMessage() {
        const recentActivitiesElement = document.getElementById('recentActivities');
        if (recentActivitiesElement) {
            recentActivitiesElement.innerHTML = `
                <div class="no-activity-message">
                    <p>Start a learning session to see your progress!</p>
                    <button class="btn primary-btn" onclick="window.location.href='/chatbot'">
                        Start Learning
                    </button>
                </div>
            `;
        }
    }

    // Render charts
    function renderCharts(progressData) {
        const chartsContainer = document.querySelector('.charts-container');
        if (!chartsContainer) return;

        if (!progressData || progressData.length === 0) {
            chartsContainer.innerHTML = `
            <div class="no-data-message">
                <p>No learning data available yet.</p>
                <p>Start a learning session to see your progress!</p>
                <button class="btn primary-btn" onclick="window.location.href='/chatbot'">
                    Start Learning
                </button>
            </div>
        `;
            return;
        }

        // Check if canvas elements exist before creating charts
        const performanceCtx = document.getElementById('performanceChart');
        const timeCtx = document.getElementById('timeChart');
        
        if (!performanceCtx || !timeCtx) {
            console.error('Chart canvas elements not found');
            return;
        }

        // Clear any existing charts to prevent memory leaks
        if (window.performanceChart) {
            window.performanceChart.destroy();
        }
        if (window.timeChart) {
            window.timeChart.destroy();
        }

        const topics = progressData.map(item => item.topic);
        const correctData = progressData.map(item => item.correct_count);
        const incorrectData = progressData.map(item => item.incorrect_count);

        // Performance chart (correct vs incorrect by topic)
        window.performanceChart = new Chart(performanceCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: topics.map(t => t.charAt(0).toUpperCase() + t.slice(1)),
                datasets: [
                    {
                        label: 'Correct',
                        data: correctData,
                        backgroundColor: '#4caf50',
                        borderColor: '#388e3c',
                        borderWidth: 1
                    },
                    {
                        label: 'Incorrect',
                        data: incorrectData,
                        backgroundColor: '#f44336',
                        borderColor: '#d32f2f',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Answers'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Subject'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    title: {
                        display: true,
                        text: 'Performance by Subject'
                    }
                }
            }
        });

        // Response time chart
        window.timeChart = new Chart(timeCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: topics.map(t => t.charAt(0).toUpperCase() + t.slice(1)),
                datasets: [
                    {
                        label: 'Average Response Time (seconds)',
                        data: progressData.map(item => item.avg_response_time),
                        backgroundColor: 'rgba(93, 64, 55, 0.2)',
                        borderColor: '#5d4037',
                        borderWidth: 2,
                        tension: 0.3
                    },
                    {
                        label: 'Optimal Range (5-20s)',
                        data: topics.map(() => 12.5), // Middle of optimal range
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        borderColor: '#4caf50',
                        borderWidth: 1,
                        borderDash: [5, 5],
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Time (seconds)'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Subject'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    title: {
                        display: true,
                        text: 'Response Time Analysis'
                    }
                }
            }
        });
    }

    // Render recent activity
     function renderRecentActivity(activities) {
        const recentActivitiesElement = document.getElementById('recentActivities');
        if (!recentActivitiesElement) return;

        if (!activities || activities.length === 0) {
            showNoDataMessage();
            return;
        }

        const activityHTML = activities.map(activity => {
            const date = new Date(activity.timestamp).toLocaleString();
            const statusClass = activity.is_correct ? 'correct' : 'incorrect';
            return `
                <div class="activity-card ${statusClass}">
                    <div class="activity-header">
                        <span class="activity-type">${activity.topic.toUpperCase()}</span>
                        <span class="activity-time">${date}</span>
                    </div>
                    <div class="activity-content">
                        <p class="activity-question">${activity.question}</p>
                        <div class="activity-answers">
                            <p>Your answer: ${activity.user_answer || 'No answer provided'}</p>
                            <p>Correct answer: ${activity.correct_answer}</p>
                        </div>
                        <div class="activity-footer">
                            <span class="response-time">Response time: ${parseFloat(activity.response_time || 0).toFixed(1)}s</span>
                            <span class="result-badge ${statusClass}">
                                ${activity.is_correct ? 'Correct' : 'Incorrect'}
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        recentActivitiesElement.innerHTML = activityHTML;
    }

    function loadTestQuestions(subject, topic) {
        const loadingElement = document.getElementById('loadingQuestions');
        const contentElement = document.getElementById('questionContent');

        if (loadingElement) loadingElement.style.display = 'block';
        if (contentElement) contentElement.style.display = 'none';

        fetch('/api/generate_test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, topic })
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Network response was not ok: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.questions?.length > 0) {
                    sessionStorage.setItem('testQuestions', JSON.stringify(data.questions));
                    displayQuestion(0);
                    if (loadingElement) loadingElement.style.display = 'none';
                    if (contentElement) contentElement.style.display = 'block';
                } else {
                    throw new Error('No questions received');
                }
            })
            .catch(error => {
                console.error('Error loading test questions:', error);
                if (loadingElement) {
                    loadingElement.innerHTML = `
                        <p>Error loading questions. Please try again.</p>
                        <button class="btn secondary-btn" onclick="document.getElementById('testInterface').style.display = 'none'">
                            Back to Dashboard
                        </button>
                    `;
                }
            });
    }

    // This function appears to be referenced but not implemented in the original code
    function displayQuestion(index) {
        const testQuestions = JSON.parse(sessionStorage.getItem('testQuestions') || '[]');
        const questionElement = document.getElementById('questionContent');
        
        if (!questionElement || !testQuestions || index >= testQuestions.length) {
            console.error('Cannot display question: missing elements or invalid index');
            return;
        }
        
        const question = testQuestions[index];
        // Implement question display logic here
        questionElement.innerHTML = `
            <div class="question">
                <h3>Question ${index + 1} of ${testQuestions.length}</h3>
                <p>${question.question}</p>
                <div class="options">
                    ${question.options.map((option, i) => `
                        <div class="option">
                            <input type="radio" name="answer" id="option${i}" value="${option}">
                            <label for="option${i}">${option}</label>
                        </div>
                    `).join('')}
                </div>
                <div class="test-controls">
                    ${index > 0 ? '<button class="btn secondary-btn" onclick="displayQuestion('+(index-1)+')">Previous</button>' : ''}
                    ${index < testQuestions.length - 1 ? 
                        '<button class="btn primary-btn" onclick="displayQuestion('+(index+1)+')">Next</button>' : 
                        '<button class="btn primary-btn" onclick="submitTest()">Submit</button>'}
                </div>
            </div>
        `;
    }

    function handleSummarize() {
        const text = document.getElementById('textInput')?.value;
        const difficulty = document.getElementById('difficulty')?.value;
        const length = document.getElementById('length')?.value || 3;
        const outputElement = document.getElementById('summaryOutput');

        if (!text || !outputElement) {
            if (outputElement) outputElement.innerText = 'Please enter some text to summarize.';
            return;
        }

        outputElement.innerText = 'Generating summary...';

        fetch('/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, difficulty, length })
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Network response was not ok: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                outputElement.innerText = data.summary || 'Error: Could not generate summary.';
            })
            .catch(error => {
                console.error('Error:', error);
                outputElement.innerText = 'Error processing the text. Please try again later.';
            });
    }

    // Expose required functions to global scope for event handlers
    window.displayQuestion = displayQuestion;
    
    // Function for test submission (referenced in displayQuestion but not implemented)
    window.submitTest = function() {
        console.log('Test submitted');
        // Implement test submission logic here
        document.getElementById('testInterface').style.display = 'none';
        alert('Test submitted successfully!');
    };

    // Cleanup on page unload
    window.addEventListener('beforeunload', function() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }
    });
});