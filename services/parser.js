const cheerio = require('cheerio');

function parseSchedule(html, groupName) {
    const $ = cheerio.load(html);
    
    // Получаем весь текст и разбиваем на строки для надежности парсинга Markdown-таблиц
    const bodyText = $('body').text();
    const lines = bodyText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    const result = {
        group: groupName,
        fetched_at: new Date().toISOString(),
        weeks: []
    };

    let currentWeek = null;
    let currentDay = null;

    const DAYS_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    
    // Интервалы пар
    const PAIR_TIMES = [
        { start: "08:00", end: "09:30" }, { start: "09:45", end: "11:15" },
        { start: "11:30", end: "13:00" }, { start: "13:50", end: "15:20" },
        { start: "15:35", end: "17:05" }, { start: "17:20", end: "18:50" },
        { start: "13:15", end: "14:45" }, { start: "15:00", end: "16:30" }, { start: "16:45", end: "18:15" }
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 1. Неделя
        if (line.includes('Первая неделя')) {
            if (currentWeek && currentWeek.days.length > 0) result.weeks.push(currentWeek);
            currentWeek = { week_name: "Первая неделя", week_id: "first", days: [] };
            currentDay = null;
            continue;
        }
        if (line.includes('Вторая неделя')) {
            if (currentWeek && currentWeek.days.length > 0) result.weeks.push(currentWeek);
            currentWeek = { week_name: "Вторая неделя", week_id: "second", days: [] };
            currentDay = null;
            continue;
        }
        if (!currentWeek) continue;

        // 2. День
        let foundDayName = null;
        for (const day of DAYS_NAMES) {
            if (line.startsWith(day)) {
                foundDayName = day;
                break;
            }
        }

        if (foundDayName) {
            if (currentDay && currentDay.pairs.length > 0) currentWeek.days.push(currentDay);
            currentDay = { date: "", weekday: foundDayName, title: line, pairs: [] };
            continue;
        }

        // 3. Пара
        if (currentDay && line.startsWith('|') && /\d{2}:\d{2}/.test(line)) {
            const columns = line.split('|').map(col => col.trim()).filter(col => col !== '');
            
            if (columns.length >= 2) {
                const timeCell = columns[0];
                const subjectCell = columns[1] || "";
                const roomCell = columns[2] || "";

                const startTimeMatch = timeCell.match(/(\d{2}:\d{2})/);
                
                if (startTimeMatch) {
                    const startTime = startTimeMatch[1];
                    const pairTimeObj = PAIR_TIMES.find(p => p.start === startTime);
                    
                    if (pairTimeObj) {
                        let fullText = subjectCell.replace(/\s+/g, ' ').trim();
                        
                        // Эвристика определения типа занятия
                        let type = 'lecture'; // По умолчанию лекция
                        let subjectName = fullText;
                        let teachers = [];

                        const teacherPatternIndex = fullText.search(/ПИ\d{4}\/\d/);
                        
                        if (teacherPatternIndex !== -1) {
                            subjectName = fullText.substring(0, teacherPatternIndex).trim();
                            const teachersPart = fullText.substring(teacherPatternIndex);
                            teachers = teachersPart.split(',').map(t => t.trim()).filter(t => t.length > 0);
                            
                            // Логика определения типа:
                            // Если преподавателей больше 1 ИЛИ в названии есть "Практика"/"Семинар"/"Лабораторная"
                            if (teachers.length > 1 || /Практика|Семинар|Лабораторная|Лаб\. работа/i.test(subjectName)) {
                                type = 'seminar';
                            }
                        } else {
                            // Если нет явного указания группы, проверяем название
                            if (/Практика|Семинар|Лабораторная/i.test(subjectName)) {
                                type = 'seminar';
                            }
                        }

                        let cleanRoom = roomCell.replace(/\(\/.*?\)/g, '').trim();
                        const rooms = cleanRoom ? cleanRoom.split(/\s+/).filter(r => r.length > 0) : [];

                        currentDay.pairs.push({
                            time_range: `${pairTimeObj.start} ${pairTimeObj.end}`,
                            start_time: pairTimeObj.start,
                            end_time: pairTimeObj.end,
                            subject: subjectName || "Нет предмета",
                            teachers: teachers,
                            rooms: rooms,
                            has_lesson: !!subjectName,
                            type: type // 'lecture' или 'seminar'
                        });
                    }
                }
            }
        }
    }

    if (currentDay && currentDay.pairs.length > 0) currentWeek.days.push(currentDay);
    if (currentWeek && currentWeek.days.length > 0) result.weeks.push(currentWeek);

    return result;
}

module.exports = { parseSchedule };
