# Bee Swarm Simulation Scripts

This directory contains various simulation scripts for the Bee Swarm project, used to demonstrate and validate the effectiveness of AI role collaboration.

## 📁 Script Overview

### Basic Simulation Scripts
- **`basic_simulation.py`** - Basic four-role collaboration simulation
- **`scenario_comparison.py`** - Comparative analysis of different development modes

### Configuration Files
- **`config/`** - Simulation parameter configuration files
- **`requirements.txt`** - Python dependency list

## 🚀 Quick Start

### Install Dependencies
```bash
pip install -r requirements.txt
```

### Run Basic Simulation
```bash
python basic_simulation.py
```

### Run Scenario Comparison
```bash
python scenario_comparison.py
```

## 📊 Output Results

The simulation scripts will produce the following outputs:

1. **Console Reports** - Real-time progress and final summaries
2. **Visualization Charts** - Graphical display of performance metrics
3. **JSON Data Files** - Detailed simulation data for further analysis

## 🔧 Custom Configuration

### Modify Simulation Parameters
Edit configuration parameters in the scripts:

```python
# Simulation duration (hours)
SIMULATION_DURATION = 200

# Team configuration
TEAM_SIZE = 4

# Task creation frequency
TASK_CREATION_RATE = 8  # Average hours
```

### Add New Scenarios
Add new scenario configurations in `scenario_comparison.py`:

```python
new_scenario = ScenarioConfig(
    name="Custom Scenario",
    workflow_type=WorkflowType.AGILE,
    team_size=6,
    automation_level=0.7,
    defect_rate=0.06
)
```

## 📈 Understanding Results

### Key Metrics Explained

1. **Completion Rate** - Completed tasks / Total created tasks
2. **Average Cycle Time** - Average time from task creation to completion
3. **Throughput** - Number of tasks completed per day
4. **Team Utilization** - Percentage of actual work time vs. available time

### Performance Analysis
- **High Throughput + Low Cycle Time** = Efficient team
- **High Completion Rate + Low Defect Rate** = High-quality output
- **Balanced Role Work Distribution** = Good collaboration

## 🛠️ Troubleshooting

### Common Issues

1. **ImportError: No module named 'simpy'**
   ```bash
   pip install simpy
   ```

2. **Charts not displaying**
   ```bash
   pip install matplotlib seaborn
   ```

3. **Simulation taking too long**
   - Reduce `SIMULATION_DURATION` parameter
   - Lower task creation frequency

### Performance Optimization
- For large-scale simulations, consider using parallel processing
- Adjust logging output level to improve runtime speed
- Use more efficient data structures for storing metrics

## 📚 Extending Scripts

### Add New Role Types
```python
class QAEngineer(Developer):
    def __init__(self, env, task_queue):
        skills = {
            TaskType.BUG_FIX: 1.3,
            TaskType.FEATURE: 0.7,
            TaskType.TECHNICAL_DEBT: 0.9
        }
        super().__init__(env, "QA Engineer", task_queue, skills=skills)
```

### Create Custom Analyzer
```python
class CustomAnalyzer:
    def __init__(self, simulation_data):
        self.data = simulation_data
    
    def calculate_custom_metric(self):
        # Implement custom analysis logic
        pass
```

## 🔗 Related Documentation

- [SimPy Simulator](../simulator-guide.en.md) - Learn about simulator architecture
- [Simulation Scenarios](../simulation-scenarios.en.md) - Detailed scenario configuration instructions
- [Effectiveness Analysis](../analysis-guide.en.md) - In-depth result analysis methods

## 📝 Contributing Guidelines

Welcome contributions of new simulation scripts or improvements to existing scripts:

1. Fork the project
2. Create a feature branch
3. Add appropriate tests
4. Update documentation
5. Submit a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../../../LICENSE) file for details. 