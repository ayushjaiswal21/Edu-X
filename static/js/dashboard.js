document.addEventListener('DOMContentLoaded', function () {
    // Initialize
    loadAnalytics();

    // Event listeners
    document.querySelectorAll('.subject-card').forEach(card => {
        card.addEventListener('click', function () {
            const subject = this.dataset.subject;
            window.location.href = `/chatbot?subject=${subject}`;
        });
    });

    document.getElementById('logoutBtn').addEventListener('click', function () {
        window.location.href = '/logout';
    });
    
    // Take Test Button Event Listener
    document.getElementById('takeTestBtn').addEventListener('click', function() {
        document.getElementById('testModal').style.display = 'block';
    });
    
    // Close Modal Button
    document.querySelectorAll('.close-modal').forEach(button => {
        button.addEventListener('click', function() {
            this.closest('.modal').style.display = 'none';
        });
    });
    
    // Test Form Submission
    document.getElementById('testForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const subject = document.getElementById('testSubject').value;
        const topic = document.getElementById('testTopic').value;
        
        if (subject && topic) {
            document.getElementById('testModal').style.display = 'none';
            document.getElementById('testTitle').textContent = `${subject.charAt(0).toUpperCase() + subject.slice(1)} - ${topic}`;
            document.getElementById('testInterface').style.display = 'block';
            
            // Start loading questions
            loadTestQuestions(subject, topic);
        }
    });

    // Load analytics
    function loadAnalytics() {
        fetch('/api/get_analytics')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                if (data.progress && data.recent_interactions) {
                    renderCharts(data.progress);
                    renderRecentActivity(data.recent_interactions);
                } else {
                    showError('No analytics data available');
                }
            })
            .catch(error => {
                console.error('Error loading analytics:', error);
                showError('Failed to load analytics data');
            });
    }

    function showError(message) {
        document.querySelector('.charts-container').innerHTML = `
        <div class="error-message">
            <p>${message}</p>
            <button onclick="loadAnalytics()">Retry</button>
        </div>
    `;
    }

    // Render charts
    function renderCharts(progressData) {
        if (progressData.length === 0) {
            // No data yet
            document.getElementById('performanceChart').parentNode.innerHTML = '<p>No learning data available yet. Start a session to see your progress!</p>';
            document.getElementById('timeChart').parentNode.innerHTML = '<p>No learning data available yet. Start a session to see your response times!</p>';
            return;
        }

        // Performance chart (correct vs incorrect by topic)
        const performanceCtx = document.getElementById('performanceChart').getContext('2d');

        const topics = progressData.map(item => item.topic);
        const correctData = progressData.map(item => item.correct_count);
        const incorrectData = progressData.map(item => item.incorrect_count);

        new Chart(performanceCtx, {
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
        const timeCtx = document.getElementById('timeChart').getContext('2d');

        new Chart(timeCtx, {
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

        if (activities.length === 0) {
            recentActivitiesElement.innerHTML = '<p>No recent activities. Start a learning session!</p>';
            return;
        }

        let activityHTML = '';

        activities.forEach(activity => {
            const date = new Date(activity.timestamp).toLocaleString();
            const statusClass = activity.is_correct ? 'activity-correct' : 'activity-incorrect';
            const statusText = activity.is_correct ? 'Correct' : 'Incorrect';
            
            // Format response time to 1 decimal place and add 's' for seconds
            const responseTime = parseFloat(activity.response_time).toFixed(1);
            
            // Add a label for rapid fire questions
            const activityType = activity.response_type === 'rapid_quiz' ? '<span class="rapid-quiz-badge">Rapid Quiz</span>' : '';
            
            activityHTML += `
                <div class="activity-item">
                    <div class="activity-info">
                        <strong>${activity.topic.charAt(0).toUpperCase() + activity.topic.slice(1)}:</strong> 
                        ${truncateText(activity.question, 40)} ${activityType}
                    </div>
                    <div class="activity-status ${statusClass}">
                        ${statusText} (${responseTime}s)
                    </div>
                </div>
            `;
        });

        recentActivitiesElement.innerHTML = activityHTML;
    }

    // Helper function to truncate text
    function truncateText(text, maxLength) {
        if (!text) return "Unknown question";
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength) + '...';
    }
    
    function loadRecentActivities() {
        const recentActivitiesContainer = document.getElementById('recentActivities');
        
        // Show loading message
        recentActivitiesContainer.innerHTML = '<p class="loading-message">Loading your recent activities...</p>';
        
        fetch('/api/recent_activity')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                if (data.error) {
                    recentActivitiesContainer.innerHTML = `<p class="error-message">${data.error}</p>`;
                    return;
                }
                
                if (!data.activities || data.activities.length === 0) {
                    recentActivitiesContainer.innerHTML = '<p>No recent activity yet. Start a learning session!</p>';
                    return;
                }
                
                // Clear loading message
                recentActivitiesContainer.innerHTML = '';
                
                // Add activity items
                data.activities.forEach(activity => {
                    const activityItem = document.createElement('div');
                    activityItem.className = 'activity-item';
                    
                    if (activity.activity_type === 'rapid_quiz') {
                        // Format time nicely
                        const responseTimeFormatted = activity.response_time.toFixed(1);
                        
                        // Create status class based on correctness
                        const statusClass = activity.is_correct ? 'correct' : 'incorrect';
                        const statusLabel = activity.is_correct ? 'Correct' : 'Incorrect';
                        
                        // Create activity HTML
                        activityItem.innerHTML = `
                            <div class="activity-content">
                                <div class="activity-header">
                                    <span class="activity-topic">${activity.topic}</span>
                                    <span class="activity-time">${formatTimestamp(activity.timestamp)}</span>
                                </div>
                                <div class="activity-question">${activity.question}</div>
                                <div class="activity-details">
                                    <span class="activity-response">Your answer: ${activity.user_answer}</span>
                                    ${!activity.is_correct ? 
                                        `<span class="activity-correct-answer">Correct answer: ${activity.correct_answer}</span>` : ''}
                                    <span class="activity-time-taken">Time: ${responseTimeFormatted}s</span>
                                    <span class="activity-status ${statusClass}">${statusLabel}</span>
                                </div>
                            </div>
                        `;
                    } else {
                        // Handle other activity types in the future
                        activityItem.innerHTML = `
                            <div class="activity-content">
                                <span class="activity-topic">${activity.topic || 'Unknown'}</span>
                                <span class="activity-time">${formatTimestamp(activity.timestamp)}</span>
                            </div>
                        `;
                    }
                    
                    recentActivitiesContainer.appendChild(activityItem);
                });
            })
            .catch(error => {
                console.error('Error loading recent activities:', error);
                recentActivitiesContainer.innerHTML = '<p class="error-message">Failed to load recent activities.</p>';
            });
    }
    
    function formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString();
    }


    // Load test questions
    function loadTestQuestions(subject, topic) {
        document.getElementById('loadingQuestions').style.display = 'block';
        document.getElementById('questionContent').style.display = 'none';
        
        fetch('/api/generate_test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ subject, topic })
        })
        .then(response => response.json())
        .then(data => {
            if (data.questions && data.questions.length > 0) {
                // Store questions in session storage
                sessionStorage.setItem('testQuestions', JSON.stringify(data.questions));
                
                // Display first question
                displayQuestion(0);
                
                document.getElementById('loadingQuestions').style.display = 'none';
                document.getElementById('questionContent').style.display = 'block';
            } else {
                throw new Error('No questions received');
            }
        })
        .catch(error => {
            console.error('Error loading test questions:', error);
            document.getElementById('loadingQuestions').innerHTML = `
                <p>Error loading questions. Please try again.</p>
                <button class="btn secondary-btn" onclick="document.getElementById('testInterface').style.display = 'none'">
                    Back to Dashboard
                </button>
            `;
        });
    }
    
    // Event listener for text summarizer
    document.getElementById('summarizeBtn').addEventListener('click', function() {
        const text = document.getElementById('textInput').value;
        const difficulty = document.getElementById('difficulty').value;
        const length = document.getElementById('length').value || 3; // Default to 3 if not specified
        
        if (!text) {
            document.getElementById('summaryOutput').innerText = 'Please enter some text to summarize.';
            return;
        }
        
        document.getElementById('summaryOutput').innerText = 'Generating summary...';
        
        fetch('/api/summarize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                text, 
                difficulty,
                length 
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.summary) {
                document.getElementById('summaryOutput').innerText = data.summary;
            } else {
                document.getElementById('summaryOutput').innerText = 'Error: Could not generate summary.';
            }
        })
        .catch(error => {
            console.error('Error:', error);
            document.getElementById('summaryOutput').innerText = 'Error processing the text. Please try again later.';
        });
    });
    
    loadRecentActivities();
    // Add CSS for rapid quiz badge
    const style = document.createElement('style');
    style.textContent = `
        .rapid-quiz-badge {
            background-color: #ff5722;
            color: white;
            font-size: 0.75rem;
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: 5px;
            font-weight: bold;
        }
    `;
    document.head.appendChild(style);
});