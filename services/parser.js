const cheerio = require('cheerio');

/**
 * Извлекает расписание из HTML-страницы s.kubsau.ru
 * @param {string} html - HTML-код страницы
 * @param {string} groupName - Номер группы (например, "ПИ2403")
 * @returns {object} - Объект с расписанием
 */
function parseSchedule(html, groupName) {
    const $ = cheerio.load(html);

    // --- 1. Получение базовой информации ---
    const group = $('h2 strong').first().text().trim() || groupName;

    let fetchedAt = '';
    const updateMatch = html.match(/Дата обновления:\s*([\d\-:\s]+)/);
    if (updateMatch) {
        fetchedAt = updateMatch[1].trim();
    } else {
        fetchedAt = new Date().toISOString();
    }

    const result = {
        group,
        fetched_at: fetchedAt,
        weeks: []
    };

    // --- 2. Функция парсинга одного дня (карточки .card-block) ---
    function parseDay(dayElement) {
        const $day = $(dayElement);
        // Извлекаем дату из класса day-YYYY-MM-DD
        const classNames = $day.attr('class') || '';
        const dateMatch = classNames.match(/day-(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : '';

        // Заголовок дня (пример: "Понедельник | 30 марта")
        const titleText = $day.find('.card-title').first().text().trim();
        let weekday = '';
        if (titleText) {
            weekday = titleText.split('|')[0].trim();
        }

        // Таблица с парами
        const pairs = [];
        const rows = $day.find('table.table tbody tr');

        rows.each((idx, row) => {
            const $row = $(row);
            const timeCell = $row.find('td.time').first();
            const dissCell = $row.find('td.diss').first();
            const roomCell = $row.find('td.who-where').first();

            // Проверяем, есть ли предмет (не пустая ячейка)
            const hasSubject = dissCell.text().trim().length > 0;
            if (!hasSubject) return; // пропускаем пустые пары

            // --- Время ---
            const timeHtml = timeCell.html() || '';
            const times = timeHtml.split('<br>').map(t => t.trim());
            let startTime = '', endTime = '';
            if (times.length >= 2) {
                startTime = times[0];
                endTime = times[1];
            } else {
                // fallback: парсим числа из текста
                const timeText = timeCell.text().trim();
                const match = timeText.match(/(\d{2}:\d{2})\s+(\d{2}:\d{2})/);
                if (match) {
                    startTime = match[1];
                    endTime = match[2];
                }
            }

            // --- Предмет и преподаватели ---
            // Копируем содержимое .diss, удаляем из копии все .diss-info,
            // чтобы получить чистое название предмета
            const dissClone = dissCell.clone();
            dissClone.find('.diss-info').remove();
            let subject = dissClone.text().trim().replace(/\s+/g, ' ');
            // Если после удаления осталось пусто, возможно предмет в <strong> и .diss-info
            if (subject === '') {
                subject = dissCell.find('strong').first().text().trim();
            }
            if (subject === '') {
                subject = dissCell.text().trim().replace(/\s+/g, ' ');
            }

            // Преподаватели: собираем текст из всех .diss-info
            const teachers = [];
            dissCell.find('.diss-info').each((i, el) => {
                let teacherText = $(el).text().trim().replace(/\s+/g, ' ');
                if (teacherText) {
                    // Разбиваем по запятым, если внутри несколько преподавателей
                    const parts = teacherText.split(',').map(p => p.trim());
                    parts.forEach(p => {
                        if (p) teachers.push(p);
                    });
                }
            });
            // Убираем дубликаты (иногда один преподаватель может попасть дважды)
            const uniqueTeachers = [...new Map(teachers.map(t => [t, t])).values()];

            // --- Аудитории ---
            const rooms = [];
            roomCell.find('a.room-link').each((i, el) => {
                const room = $(el).text().trim();
                if (room) rooms.push(room);
            });
            // Если ссылок нет, возможно аудитория записана простым текстом
            if (rooms.length === 0) {
                const roomText = roomCell.text().trim();
                if (roomText) {
                    // Может быть несколько аудиторий через пробел
                    const splitRooms = roomText.split(/\s+/);
                    splitRooms.forEach(r => { if (r) rooms.push(r); });
                }
            }

            // --- Формируем объект пары ---
            pairs.push({
                time_range: `${startTime} ${endTime}`,
                start_time: startTime,
                end_time: endTime,
                subject: subject || 'Без названия',
                teachers: uniqueTeachers,
                rooms: rooms,
                has_lesson: true
            });
        });

        return {
            date,
            weekday,
            title: titleText,
            pairs
        };
    }

    // --- 3. Парсинг вкладок первой и второй недели ---
    const firstTab = $('#first');
    const secondTab = $('#second');

    if (firstTab.length) {
        const firstWeekDiv = firstTab.find('.schedule-first-week');
        if (firstWeekDiv.length) {
            const days = [];
            firstWeekDiv.find('.card-block').each((i, el) => {
                const dayData = parseDay(el);
                if (dayData.pairs.length > 0) {
                    days.push(dayData);
                }
            });
            if (days.length) {
                result.weeks.push({
                    week_name: 'Первая неделя',
                    week_id: 'first',
                    days
                });
            }
        }
    }

    if (secondTab.length) {
        const secondWeekDiv = secondTab.find('.schedule-second-week');
        if (secondWeekDiv.length) {
            const days = [];
            secondWeekDiv.find('.card-block').each((i, el) => {
                const dayData = parseDay(el);
                if (dayData.pairs.length > 0) {
                    days.push(dayData);
                }
            });
            if (days.length) {
                result.weeks.push({
                    week_name: 'Вторая неделя',
                    week_id: 'second',
                    days
                });
            }
        }
    }

    // --- 4. Fallback: если не нашли табы, пробуем спарсить из .fast-schedule (только три дня) ---
    if (result.weeks.length === 0) {
        const fastDays = $('.fast-schedule .card-block');
        if (fastDays.length) {
            const days = [];
            fastDays.each((i, el) => {
                const dayData = parseDay(el);
                if (dayData.pairs.length) days.push(dayData);
            });
            if (days.length) {
                result.weeks.push({
                    week_name: 'Текущая неделя',
                    week_id: 'current',
                    days
                });
            }
        }
    }

    return result;
}

module.exports = { parseSchedule };